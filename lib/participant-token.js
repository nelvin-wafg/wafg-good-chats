// HMAC-signed participant identity tokens.
// stored in an HttpOnly cookie so the browser can't read or modify them.
// the server treats the cookie as the source of truth for "who is this participant"
// — never trusts client-provided participantId.

import { createHmac } from 'crypto';

const TOKEN_TTL_SECONDS = 8 * 60 * 60; // 8 hours covers any reasonable session length

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

// constant-time string comparison to avoid timing attacks
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export function signParticipantToken({ sessionId, participantId }) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + TOKEN_TTL_SECONDS;
  const payload = JSON.stringify({ sid: sessionId, pid: participantId, iat, exp });
  const payloadB64 = base64urlEncode(payload);
  const sig = hmacSha256(payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyParticipantToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  const expected = hmacSha256(payloadB64);
  if (!timingSafeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(base64urlDecode(payloadB64).toString('utf-8'));
    if (!payload.sid || !payload.pid || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return { sessionId: payload.sid, participantId: payload.pid };
  } catch {
    return null;
  }
}

export const PARTICIPANT_COOKIE_NAME = 'wafg_pt';
export const PARTICIPANT_COOKIE_MAX_AGE_SECONDS = TOKEN_TTL_SECONDS;

// helper: read + verify the cookie for a given session id.
// returns { participantId } if valid + matches the session, otherwise null.
export function getParticipantFromCookies(cookieStore, sessionId) {
  const token = cookieStore.get(PARTICIPANT_COOKIE_NAME)?.value;
  if (!token) return null;
  const verified = verifyParticipantToken(token);
  if (!verified) return null;
  if (verified.sessionId !== sessionId) return null;
  return { participantId: verified.participantId };
}

// cookie options used by routes when setting the participant cookie
export const PARTICIPANT_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: TOKEN_TTL_SECONDS,
  path: '/',
};
