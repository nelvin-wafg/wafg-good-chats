// the referral tracker: a member's personal invite link, who opened it, who showed interest and who
// actually joined their first call because of it. server-only.
//
// how credit works (first touch, first-timers only):
//   1. /i/<code> sets a 30-day cookie holding the inviter's code (the first link a browser opens
//      wins; a later link doesn't replace it).
//   2. when that browser saves a spot or signs up for the notify list, an event is recorded.
//   3. when that browser JOINS a call and the person has never been in a call before, the
//      inviter is stored on the new profile (profiles.referred_by) and a 'joined' event is recorded.
//   "people you brought" = profiles whose referred_by is you. existing members clicking a link
//   never count, and nobody can credit themselves.
import { randomBytes, createHash } from 'crypto';

export const REF_COOKIE = 'wafg_ref';
export const VISITOR_COOKIE = 'wafg_vid';
const THIRTY_DAYS = 30 * 24 * 60 * 60;
const COOKIE_BASE = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' };
export const REF_COOKIE_OPTIONS = { ...COOKIE_BASE, maxAge: THIRTY_DAYS };
export const VISITOR_COOKIE_OPTIONS = { ...COOKIE_BASE, maxAge: 365 * 24 * 60 * 60 };

// no look-alike characters (no 0/o, 1/l/i): easy to read aloud and type
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const INVITE_CODE_RE = /^[a-hj-km-np-z2-9]{9}$/;

export function newInviteCode() {
  const bytes = randomBytes(9);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export function emailKey(email) {
  return 'e:' + createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 24);
}

export function isMissingSchema(error) {
  const code = String(error?.code || '');
  return code === '42P01' || code === 'PGRST205' || code === '42703' || code === 'PGRST204';
}

// look up the inviter for a code (null if the code is unknown or malformed)
export async function findInviter(admin, code) {
  if (!code || !INVITE_CODE_RE.test(code)) return null;
  const { data } = await admin.from('profiles').select('id, email, display_name').eq('invite_code', code).maybeSingle();
  return data || null;
}

// best-effort: a tracking failure must never break joining, saving a spot or signing up
export async function recordReferralEvent(admin, { referrerId, visitorKey, event, inviteeProfileId = null, sessionId = null }) {
  try {
    await admin
      .from('referral_events')
      .upsert([{ referrer_id: referrerId, visitor_key: visitorKey, event, invitee_profile_id: inviteeProfileId, session_id: sessionId }], {
        onConflict: 'referrer_id,visitor_key,event',
        ignoreDuplicates: true,
      });
  } catch {}
}

// an RSVP or notify-list signup made from a browser that arrived through an invite link
export async function attributeInterest(admin, { code, email, event, sessionId = null }) {
  try {
    const inviter = await findInviter(admin, code);
    if (!inviter) return;
    if (String(inviter.email).toLowerCase() === String(email).toLowerCase()) return; // not yourself
    await recordReferralEvent(admin, { referrerId: inviter.id, visitorKey: emailKey(email), event, sessionId });
  } catch {}
}

// a person just joined a call. credit the inviter only if this is the person's first call ever.
export async function attributeJoin(admin, { code, profileId, participantId, sessionId }) {
  try {
    const inviter = await findInviter(admin, code);
    if (!inviter || inviter.id === profileId) return;
    const { count } = await admin
      .from('participants')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', profileId)
      .neq('id', participantId);
    if ((count || 0) > 0) return; // been in a call before: not someone you brought
    await admin.from('profiles').update({ referred_by: inviter.id }).eq('id', profileId).is('referred_by', null);
    await recordReferralEvent(admin, { referrerId: inviter.id, visitorKey: `p:${profileId}`, event: 'joined', inviteeProfileId: profileId, sessionId });
  } catch {}
}
