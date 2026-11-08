import { NextResponse } from 'next/server';
import { SIGNIN_COOKIE_NAME } from '@/lib/signin-cookie';
import { PROFILE_COOKIE_NAME } from '@/lib/profile-cookie';

// POST /api/profiles/signout · forgets this browser: clears the signed-in cookie and the profile
// cookie. (it only affects the browser that asks · other devices stay as they are.)
export async function POST() {
  const res = NextResponse.json({ ok: true });
  for (const name of [SIGNIN_COOKIE_NAME, PROFILE_COOKIE_NAME]) {
    res.cookies.set(name, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 0, path: '/' });
  }
  return res;
}
