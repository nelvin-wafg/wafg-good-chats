// HMAC-signed persistent cookie that remembers a profile across sessions.
// long-lived (6 months) so returning participants skip the join form.
// uses the same SESSION_SECRET as participant-token.js · format is similar.

import { signData, verifyData } from './secrets';

const TOKEN_TTL_SECONDS = 6 * 30 * 24 * 60 * 60; // ~6 months

function base64urlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64urlDecode(s) {
  const padLen = (4 - (s.length % 4)) % 4;
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  return Buffer.from(b64, 'base64');
}

export function signProfileToken({ profileId }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ pfid: profileId, iat, exp });
  const payloadB64 = base64urlEncode(payload);
  const sig = signData(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyProfileToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!verifyData(payloadB64, sig)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
    if (!payload.pfid || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    // emergency lever: set PROFILE_COOKIE_MIN_IAT (unix seconds) in the environment to make every
    // profile cookie issued before that moment stop working (everyone just re-joins or signs in
    // once). unset = no effect. use it if you ever suspect cookies were handed out wrongly.
    const minIat = Number(process.env.PROFILE_COOKIE_MIN_IAT || 0);
    if (minIat && !(payload.iat >= minIat)) return null;
    return { profileId: payload.pfid };
  } catch {
    return null;
  }
}

export const PROFILE_COOKIE_NAME = 'wafg_pf';
export const PROFILE_COOKIE_MAX_AGE_SECONDS = TOKEN_TTL_SECONDS;

export function getProfileFromCookies(cookieStore) {
  const token = cookieStore.get(PROFILE_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyProfileToken(token);
}

export const PROFILE_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: TOKEN_TTL_SECONDS,
  path: '/',
};
