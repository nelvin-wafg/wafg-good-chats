// "do you really want back on the list?" links. server-only.
//
// someone who unsubscribed stays unsubscribed even if a sign-up form is filled in with their
// address: anyone can type any email, so a form alone proves nothing. instead we email THAT address
// a link; only clicking it (the person it was sent to) puts them back on the list.
//
// signed with the shared signing key (lib/secrets.js) under its own 'resubscribe:' prefix so a
// signature made here can't be valid as any other token. expires after 7 days. like the unsubscribe
// link it carries the email itself, signed, so it can't be forged for someone else's address.
import { signData, verifyData } from './secrets';

const SITE = 'https://goodchats.weareforgood.com';
const TTL_SECONDS = 7 * 24 * 60 * 60;

const b64e = (s) => Buffer.from(s, 'utf-8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64d = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64').toString('utf-8');
const sign = (payload) => signData(`resubscribe:${payload}`);

export function signResubscribeToken(email, now = Date.now()) {
  const payload = b64e(JSON.stringify({ e: String(email).trim().toLowerCase(), exp: Math.floor(now / 1000) + TTL_SECONDS }));
  return `${payload}.${sign(payload)}`;
}

// returns the (lowercased) email, or null if the token is missing, forged, malformed or expired
export function verifyResubscribeToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  try {
    if (!verifyData(`resubscribe:${payload}`, sig)) return null;
    const d = JSON.parse(b64d(payload));
    if (!d.e || !String(d.e).includes('@') || !d.exp || d.exp < Math.floor(now / 1000)) return null;
    return String(d.e);
  } catch {
    return null;
  }
}

export function resubscribePageUrl(email) {
  return `${SITE}/resubscribe?t=${signResubscribeToken(email)}`;
}
