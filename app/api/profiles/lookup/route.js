import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { validateEmail, validateUuid, ValidationError } from '@/lib/validate';
import { rateLimitByIp } from '@/lib/rate-limit';

// POST /api/profiles/lookup  body: { email, sessionId }
// returns { found: bool, profile?: { display_name, linkedin_url, newsletter_opt_in } }
// used by the join form to autofill returning users.
// requires a valid, non-ended session context · this narrows email enumeration
// to active session windows rather than allowing open-ended probing of the member list.
export async function POST(request) {
  const ok = await rateLimitByIp(request, 'profile-lookup', { limit: 20, windowSeconds: 300 });
  if (!ok) return new NextResponse('too many lookups', { status: 429 });

  let email, sessionId;
  try {
    const body = await request.json();
    email = validateEmail(body?.email);
    sessionId = validateUuid(body?.sessionId, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();

  // gate: the lookup only works against a real, non-ended session
  const { data: session } = await admin
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session || session.status === 'ended') {
    return NextResponse.json({ found: false });
  }

  const { data } = await admin
    .from('profiles')
    .select('display_name, linkedin_url, newsletter_opt_in')
    .eq('email', email)
    .maybeSingle();

  if (!data) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    profile: {
      display_name: data.display_name,
      linkedin_url: data.linkedin_url,
      newsletter_opt_in: data.newsletter_opt_in,
    },
  });
}
