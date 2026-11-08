import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { consumeLoginToken } from '@/lib/login-link';
import { signSignInToken, SIGNIN_COOKIE_NAME, SIGNIN_COOKIE_OPTIONS } from '@/lib/signin-cookie';
import { signProfileToken, PROFILE_COOKIE_NAME, PROFILE_COOKIE_OPTIONS } from '@/lib/profile-cookie';

// POST /api/auth/consume  body: { token }
// spends a one-time sign-in link (the person pressed "continue" on /signin). on success the
// browser gets the signed-in cookie plus the ordinary profile cookie (so "welcome back" on the
// join form works too). the link only ever reaches the inbox it was sent to, so using it also
// proves they own that address: the profile's email is marked verified.
//
// it's a POST, not a GET, on purpose: email scanners open links automatically and would
// otherwise use up the one-time token before the person did.
export async function POST(request) {
  if (!(await rateLimitByIp(request, 'signin-consume', { limit: 20, windowSeconds: 600 }))) {
    return new NextResponse('too many attempts · try again in a few minutes', { status: 429 });
  }

  let token;
  try {
    const body = await request.json();
    token = String(body?.token || '');
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const profileId = await consumeLoginToken(admin, token);
  if (!profileId) return new NextResponse('this link has expired or was already used', { status: 400 });

  await admin
    .from('profiles')
    .update({ email_verified_at: new Date().toISOString() })
    .eq('id', profileId)
    .is('email_verified_at', null);

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SIGNIN_COOKIE_NAME, signSignInToken({ profileId }), SIGNIN_COOKIE_OPTIONS);
  res.cookies.set(PROFILE_COOKIE_NAME, signProfileToken({ profileId }), PROFILE_COOKIE_OPTIONS);
  return res;
}
