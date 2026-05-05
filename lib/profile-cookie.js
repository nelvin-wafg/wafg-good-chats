// HMAC-signed persistent cookie that remembers a profile across sessions.
// long-lived (6 months) so returning participants skip the join form.
// uses the same SESSION_SECRET as participant-token.js · format is similar.

import { createHmac } from 'crypto';

const TOKEN_TTL_SECONDS = 6 * 30 * 24 * 60 * 60; // ~6 months

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET env var must be set and at least 32 chars');
  }
  return s;
}

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

function hmacSha256(payload) {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function signProfileToken({ profileId }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ pfid: profileId, iat, exp });
  const payloadB64 = base64urlEncode(payload);
  const sig = hmacSha256(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyProfileToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = hmacSha256(payloadB64);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
    if (!payload.pfid || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
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
