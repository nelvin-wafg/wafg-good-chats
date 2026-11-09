// HMAC-signed email verification tokens · sent as a link in the "verify your
// email" message to anyone joining with a brand-new email address. same
// signing pattern as participant-token.js / profile-cookie.js, reusing
// SESSION_SECRET rather than adding a new env var.

import { signData, verifyData } from './secrets';

const TOKEN_TTL_SECONDS = 48 * 60 * 60; // 48h · enough to check email after a live event

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

export function signEmailVerifyToken({ profileId, email }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ pfid: profileId, email, iat, exp });
  const payloadB64 = base64urlEncode(payload);
  const sig = signData(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyEmailVerifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!verifyData(payloadB64, sig)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
    if (!payload.pfid || !payload.email || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { profileId: payload.pfid, email: payload.email };
  } catch {
    return null;
  }
}
