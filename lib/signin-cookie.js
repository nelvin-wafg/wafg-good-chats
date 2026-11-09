// the "signed in" cookie · proof that someone clicked a one-time link sent to the profile's own
// inbox. it is separate from (and stronger than) the profile cookie in profile-cookie.js:
// that one is handed out by the join form to anyone who types an email, with no proof they own
// it, so it only unlocks the low-sensitivity bits. things that reveal who someone talked to
// (the "people you've met" list) require THIS cookie.
//
// HMAC-signed with SESSION_SECRET, like the other cookies. the 'signin:' prefix means a
// signature made here can never be valid as any other token. shorter-lived than the profile
// cookie on purpose.
import { signData, verifyData } from './secrets';

const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days

const b64urlEncode = (str) => Buffer.from(str, 'utf-8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64urlDecode = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64').toString('utf-8');
const sign = (payloadB64) => signData(`signin:${payloadB64}`);

export function signSignInToken({ profileId }) {
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64urlEncode(JSON.stringify({ pfid: profileId, iat, exp: iat + TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

export function verifySignInToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!verifyData(`signin:${payload}`, sig)) return null;
  try {
    const p = JSON.parse(b64urlDecode(payload));
    if (!p.pfid || !p.exp || p.exp < Math.floor(Date.now() / 1000)) return null;
    return { profileId: p.pfid };
  } catch {
    return null;
  }
}

export const SIGNIN_COOKIE_NAME = 'wafg_si';

export function getSignInFromCookies(cookieStore) {
  const token = cookieStore.get(SIGNIN_COOKIE_NAME)?.value;
  return token ? verifySignInToken(token) : null;
}

export const SIGNIN_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: TTL_SECONDS,
  path: '/',
};
