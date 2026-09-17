import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { validateEmail, validateUuid, ValidationError } from '@/lib/validate';
import { rateLimitByIp } from '@/lib/rate-limit';

// POST /api/profiles/lookup  body: { email, sessionId }
// returns { found: bool, profile?: { display_name } }
// used by the join form to autofill returning users' name only. linkedin_url and
// newsletter_opt_in are deliberately withheld: session ids aren't secret (every
// visitor to any public join page gets one for free), so this endpoint is reachable
// by anyone who can guess/collect an email — returning only a bare name keeps a
// batch-checked email list from also harvesting LinkedIn URLs or subscription status
// for the whole cross-session member base. the join form already has both of those
// via the profile cookie for a genuinely returning user; this lookup is only for the
// case where someone types a known email on a device that doesn't carry that cookie.
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
    .select('display_name')
    .eq('email', email)
    .maybeSingle();

  if (!data) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    profile: {
      display_name: data.display_name,
    },
  });
}
