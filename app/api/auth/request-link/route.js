import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { adminClient } from '@/lib/supabase-server';
import { validateEmail, ValidationError } from '@/lib/validate';
import { rateLimitByIp, checkRateLimit } from '@/lib/rate-limit';
import { createLoginTokens, loginUrl, SIGNIN_LINK_TTL_MS } from '@/lib/login-link';
import { sendLoginLinkEmail } from '@/lib/resend';

// POST /api/auth/request-link  body: { email }
// optional passwordless sign-in: emails a one-time link to a profile's address.
//
// the answer is the SAME whether or not a profile exists for that email, so this can't be
// used to find out who has used Good Chats. abuse limits: per IP and per address, so nobody
// can use it to flood someone's inbox.
export async function POST(request) {
  if (!(await rateLimitByIp(request, 'signin-link', { limit: 6, windowSeconds: 600 }))) {
    return new NextResponse('Too many requests · try again in a few minutes', { status: 429 });
  }

  let email;
  try {
    const body = await request.json();
    email = validateEmail(body?.email);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('Bad request', { status: 400 });
  }

  const sent = NextResponse.json({ ok: true });

  // at most 3 links per address per hour (the rate-limit table keeps rows for one hour)
  const bucket = `signin-email:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
  const { ok: underLimit } = await checkRateLimit(bucket, 3, 3600);
  if (!underLimit) return sent; // say nothing: same reply as success

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, display_name, email')
    .eq('email', email)
    .maybeSingle();
  if (!profile) return sent;

  const made = await createLoginTokens(admin, [profile.id], SIGNIN_LINK_TTL_MS);
  if (!made.ok) {
    if (made.setupNeeded) return new NextResponse('Sign-in is not set up yet', { status: 503 });
    console.error('[auth] could not create sign-in token');
    return new NextResponse('Could not send a link right now', { status: 500 });
  }

  await sendLoginLinkEmail({
    to: profile.email,
    name: (profile.display_name || '').split(' ')[0],
    url: loginUrl(made.tokens[profile.id]),
    minutes: Math.round(SIGNIN_LINK_TTL_MS / 60000),
  });
  return sent;
}
