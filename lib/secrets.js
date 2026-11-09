// the signing key, and how to change it without logging everyone out. server-only.
//
// one secret (SESSION_SECRET) signs every cookie and link we issue: participant and profile
// cookies, the signed-in cookie, email-verification, unsubscribe and tracked-link tokens.
// if it ever leaked you would have to replace it, and replacing it used to break everything
// signed with the old one at once (everyone logged out, every unsubscribe link in every old email dead).
//
// rotation, with no breakage:
//   1. set SESSION_SECRET_PREVIOUS to the OLD value and SESSION_SECRET to a NEW random value
//   2. deploy. new things are signed with the new key; things signed with the old key still verify
//   3. later (see docs/SECURITY.md for how long), remove SESSION_SECRET_PREVIOUS
// SESSION_SECRET_PREVIOUS may hold more than one old key, separated by commas.
import { createHmac, timingSafeEqual } from 'crypto';

const MIN_LENGTH = 32;
const clean = (s) => (typeof s === 'string' ? s.trim() : '');

// the key used to SIGN new things
export function signingSecret() {
  const s = clean(process.env.SESSION_SECRET);
  if (!s || s.length < MIN_LENGTH) {
    throw new Error('SESSION_SECRET env var must be set and at least 32 chars');
  }
  return s;
}

// every key a signature may have been made with: the current one first, then any previous ones
export function verifySecrets() {
  const current = signingSecret();
  const previous = clean(process.env.SESSION_SECRET_PREVIOUS)
    .split(',')
    .map(clean)
    .filter((s) => s.length >= MIN_LENGTH && s !== current);
  return [current, ...previous];
}

const hex = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

// sign `data` with the current key (hex)
export function signData(data) {
  return hex(signingSecret(), data);
}

// true if `sig` is a valid signature of `data` under the current key or any previous one.
// compared in constant time, and every key is always checked so timing doesn't reveal which matched.
export function verifyData(data, sig) {
  if (typeof sig !== 'string') return false;
  let ok = false;
  for (const secret of verifySecrets()) {
    const expected = Buffer.from(hex(secret, data));
    const given = Buffer.from(sig);
    if (expected.length === given.length && timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}
