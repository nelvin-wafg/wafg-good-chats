// the day-after follow-up email: for each person who was in a call that ended roughly a day ago,
// send ONE "who do you want to talk to again?" email listing the people they were paired with, with
// a ready-to-send note for each (LinkedIn buttons only for people they starred), plus their
// personal invite link. runs inside the daily /api/cron/reminders job (the free hosting plan has
// no room for a third scheduled job). server-only.
import { adminClient } from './supabase-server';
import { sendFollowUpEmail } from './resend';
import { sendPooled, unsubscribedEmails } from './notify';
import { buildPartnerLists, noShowRooms } from './recap-partners';
import { trackedLinkUrl } from './track-link';
import { ensureInviteCodes } from './referral';

// sessions that ended between 48 and 16 hours ago. the 13:00 UTC run is ~19h after a typical
// 18:20 UTC finish, and a missed day is still covered the next day
export const FOLLOWUP_MIN_AGE_MS = 16 * 60 * 60 * 1000;
export const FOLLOWUP_MAX_AGE_MS = 48 * 60 * 60 * 1000;
const MAX_PER_RUN = 100;
const STAMP_EVERY = 20;
const SITE = 'https://goodchats.weareforgood.com';
const norm = (e) => String(e || '').trim().toLowerCase();
const isMissingColumn = (e) => e?.code === '42703' || e?.code === 'PGRST204';

export async function sendFollowUps({ now = Date.now(), deadline = Infinity } = {}) {
  const admin = adminClient();
  const out = { sessions: 0, eligible: 0, attempted: 0, sent: 0, failed: 0, skipped: 0, setupNeeded: false };

  const { data: sessions, error: sErr } = await admin
    .from('sessions')
    .select('id, name, ended_at')
    .eq('status', 'ended')
    .gte('ended_at', new Date(now - FOLLOWUP_MAX_AGE_MS).toISOString())
    .lte('ended_at', new Date(now - FOLLOWUP_MIN_AGE_MS).toISOString());
  if (sErr) throw new Error(`could not read sessions: ${sErr.message}`);
  out.sessions = (sessions || []).length;
  if (out.sessions === 0) return out;

  const unsubscribed = await unsubscribedEmails(admin);
  let budget = MAX_PER_RUN;

  for (const s of sessions) {
    if (budget <= 0 || Date.now() > deadline) break;

    const [partsRes, pairRes, roundsRes, capRes, waitRes] = await Promise.all([
      admin.from('participants')
        .select('id, name, kicked_at, profile_id, followup_sent_at, profiles(email, email_verified_at, display_name)')
        .eq('session_id', s.id),
      admin.from('pairings').select('round_id, participant_a_id, participant_b_id, room_name, room_label').eq('session_id', s.id),
      admin.from('rounds').select('id, round_number, prompt_text').eq('session_id', s.id),
      admin.from('captures').select('capturer_id, captured_id, captured_linkedin_url').eq('session_id', s.id),
      admin.from('connection_events').select('payload').eq('session_id', s.id).eq('event_type', 'partner-wait').limit(1000),
    ]);
    if (partsRes.error) {
      if (isMissingColumn(partsRes.error)) { out.setupNeeded = true; return out; }
      throw new Error(`could not read participants: ${partsRes.error.message}`);
    }
    const participants = partsRes.data || [];
    const rounds = roundsRes.data || [];
    const captures = capRes.data || [];
    const promptByRound = new Map(rounds.map((r) => [r.round_number, r.prompt_text]));
    const linkedinByKey = new Map(captures.map((c) => [`${c.capturer_id}:${c.captured_id}`, c.captured_linkedin_url]));

    const lists = buildPartnerLists({
      pairings: pairRes.data || [], rounds, participants, captures,
      noShows: noShowRooms(waitRes.data || []),
    });

    // one email per address, only verified, un-removed, not unsubscribed, not already sent
    const seen = new Set();
    const eligible = [];
    for (const p of participants) {
      const email = norm(p.profiles?.email);
      if (!email || !p.profiles?.email_verified_at || p.kicked_at || p.followup_sent_at) continue;
      if (seen.has(email)) continue;
      if (unsubscribed.has(email)) { out.skipped += 1; continue; }
      const partners = lists[p.id] || [];
      if (partners.length === 0) { out.skipped += 1; continue; }
      seen.add(email);
      eligible.push({ p, email, partners });
    }
    out.eligible += eligible.length;
    const batch = eligible.slice(0, budget);
    if (batch.length === 0) continue;

    const codes = await ensureInviteCodes(admin, batch.map((b) => b.p.profile_id));

    for (let i = 0; i < batch.length; i += STAMP_EVERY) {
      if (Date.now() > deadline) break;
      const chunk = batch.slice(i, i + STAMP_EVERY);
      const results = await sendPooled(chunk, ({ p, email, partners }) =>
        sendFollowUpEmail({
          to: email,
          firstName: String(p.profiles?.display_name || p.name || '').trim().split(/\s+/)[0] || null,
          sessionName: s.name,
          inviteUrl: codes[p.profile_id] ? `${SITE}/i/${codes[p.profile_id]}` : null,
          partners: partners.map((pt) => {
            const li = pt.starred ? linkedinByKey.get(`${p.id}:${pt.partnerId}`) : null;
            return {
              name: pt.name,
              round: pt.round,
              roomLabel: pt.roomLabel,
              prompt: promptByRound.get(pt.round) || null,
              linkedinUrl: li ? trackedLinkUrl({ url: li, kind: 'followup-linkedin', profileId: p.profile_id, sessionId: s.id }) : null,
            };
          }),
        })
      );
      const sentIds = chunk.filter((_, j) => results[j]?.ok).map((c) => c.p.id);
      out.attempted += chunk.length;
      out.sent += sentIds.length;
      out.failed += chunk.length - sentIds.length;
      budget -= chunk.length;
      if (sentIds.length > 0) {
        await admin.from('participants').update({ followup_sent_at: new Date().toISOString() }).in('id', sentIds);
      }
    }
  }
  return out;
}
