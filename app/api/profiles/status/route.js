import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getProfileFromCookies } from '@/lib/profile-cookie';
import { getSignInFromCookies } from '@/lib/signin-cookie';

// GET /api/profiles/status
// the homepage's sign-in button asks this so it can say "Sign in" or "My profile". the login
// cookies are httpOnly, so the page can't read them itself. this only checks the signatures on
// the caller's OWN cookies: no database lookup, no profile data, nothing about anyone else. the
// answer is one word about this browser, so it can't be used to find out who has a profile.
//
//   'none'      no recognised cookie · show "Sign in"
//   'known'     this browser has a profile cookie · show "My profile"
//   'signedIn'  this browser clicked a one-time link · show "My profile"
export async function GET() {
  const cookieStore = cookies();
  const state = getSignInFromCookies(cookieStore)?.profileId
    ? 'signedIn'
    : getProfileFromCookies(cookieStore)?.profileId
      ? 'known'
      : 'none';
  return NextResponse.json({ state }, { headers: { 'Cache-Control': 'no-store' } });
}
