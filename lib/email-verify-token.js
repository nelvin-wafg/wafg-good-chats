// HMAC-signed email verification tokens · sent as a link in the "verify your
// email" message to anyone joining with a brand-new email address. same
// signing pattern as participant-token.js / profile-cookie.js, reusing
// SESSION_SECRET rather than adding a new env var.

import { createHmac } from 'crypto';

const TOKEN_TTL_SECONDS = 48 * 60 * 60; // 48h · enough to check email after a live event

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

export function signEmailVerifyToken({ profileId, email }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ pfid: profileId, email, iat, exp });
  const payloadB64 = base64urlEncode(payload);
  const sig = hmacSha256(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyEmailVerifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = hmacSha256(payloadB64);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
    if (!payload.pfid || !payload.email || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { profileId: payload.pfid, email: payload.email };
  } catch {
    return null;
  }
}
