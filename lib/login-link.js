// one-time sign-in links. server-only.
//
// a link carries a random 32-byte secret; only its SHA-256 hash is stored (table
// `login_tokens`), so a database leak can't be turned into working links. a token works once
// and until it expires. "one time" is enforced by a single atomic UPDATE (used_at is set only
// where it was still null), so two simultaneous clicks can't both win.
//
// email scanners (Outlook Safe Links, Gmail, corporate filters) open links before the person
// does, and a scanner's GET would burn a one-time token. so the link only opens a page
// (/signin?t=...) and the token is consumed when the person presses the button there (POST
// /api/auth/consume), which scanners don't do.
import { randomBytes, createHash } from 'crypto';

const SITE = 'https://goodchats.weareforgood.com';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const SIGNIN_LINK_TTL_MS = 15 * 60 * 1000;          // asked for on /signin
export const RECAP_LINK_TTL_MS = 30 * 24 * 60 * 60 * 1000; // the button in a recap email

const hash = (t) => createHash('sha256').update(t).digest('hex');

// the table not existing yet (SQL not run) is an expected state, not an error
export function isMissingTable(error) {
  const code = String(error?.code || '');
  return code === '42P01' || code === 'PGRST205' || /login_tokens/.test(String(error?.message || '')) && /does not exist|schema cache/i.test(String(error?.message || ''));
}

export function loginUrl(token) {
  return `${process.env.NEXT_PUBLIC_APP_URL || SITE}/signin?t=${encodeURIComponent(token)}`;
}

// one token per profile id. returns { ok, tokens: { [profileId]: token }, setupNeeded? }.
// never throws: callers (the recap) must carry on without links if this fails.
export async function createLoginTokens(admin, profileIds, ttlMs) {
  const ids = [...new Set((profileIds || []).filter(Boolean))];
  if (ids.length === 0) return { ok: true, tokens: {} };
  const tokens = {};
  const rows = ids.map((id) => {
    const token = randomBytes(32).toString('base64url');
    tokens[id] = token;
    return { profile_id: id, token_hash: hash(token), expires_at: new Date(Date.now() + ttlMs).toISOString() };
  });
  try {
    const { error } = await admin.from('login_tokens').insert(rows);
    if (error) return { ok: false, tokens: {}, setupNeeded: isMissingTable(error) };
    return { ok: true, tokens };
  } catch {
    return { ok: false, tokens: {} };
  }
}

// spends a token. returns the profile id, or null if it's malformed, unknown, expired or used.
export async function consumeLoginToken(admin, token) {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const { data, error } = await admin
    .from('login_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('token_hash', hash(token))
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('profile_id');
  if (error || !data || data.length !== 1) return null;
  return data[0].profile_id;
}
