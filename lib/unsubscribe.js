// signed unsubscribe links for the emails we send to the notify list / saved spots.
// same HMAC pattern as email-verify-token.js (reuses SESSION_SECRET). server-only.
//
// the link carries the email itself, signed, so it can't be forged for someone else's
// address. unlike the verification link it has NO expiry: people unsubscribe from emails
// that are months old, and a dead link there is both useless and a compliance problem.
import { createHmac, timingSafeEqual } from 'crypto';

const SITE = 'https://goodchats.weareforgood.com';

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) {
    throw new Error('SESSION_SECRET env var must be set and at least 32 chars');
  }
  return s;
}

function b64urlEncode(str) {
  return Buffer.from(str, 'utf-8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function b64urlDecode(s) {
  const pad = (4 - (s.length % 4)) % 4;
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64').toString('utf-8');
}

// the 'unsubscribe:' prefix keeps this signature from ever being valid as any other token
function sign(payloadB64) {
  return createHmac('sha256', getSecret()).update(`unsubscribe:${payloadB64}`).digest('hex');
}

export function signUnsubscribeToken(email) {
  const payload = b64urlEncode(String(email).trim().toLowerCase());
  return `${payload}.${sign(payload)}`;
}

// returns the (lowercased) email, or null if the token is missing, malformed or forged
export function verifyUnsubscribeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  let expected;
  try {
    expected = sign(payload);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const email = b64urlDecode(payload);
    return email.includes('@') ? email : null;
  } catch {
    return null;
  }
}

// what people click in the footer: a page that asks "unsubscribe?" (a GET must never
// unsubscribe anyone, because email security scanners open every link in a message)
export function unsubscribePageUrl(email) {
  return `${SITE}/unsubscribe?t=${signUnsubscribeToken(email)}`;
}

// what mail clients POST to for the one-click "Unsubscribe" button (RFC 8058)
export function unsubscribeApiUrl(email) {
  return `${SITE}/api/unsubscribe?t=${signUnsubscribeToken(email)}`;
}

// "d***@gmail.com" · shown on the confirm page so a forwarded link doesn't expose the address
export function maskEmail(email) {
  const [user = '', domain = ''] = String(email).split('@');
  return `${user.slice(0, 1)}${'*'.repeat(Math.max(2, Math.min(5, user.length - 1)))}@${domain}`;
}
