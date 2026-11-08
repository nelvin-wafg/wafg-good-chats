// the signed-in profile's history across every session: who they were paired with, how many
// calls that adds up to, and how many different people.
//
// pure function · the /api/profiles/me route does the queries and passes rows in. it reuses
// buildPartnerLists, so the rules match the recap email exactly: sit-outs, rooms where the
// partner never showed, and host-removed partners don't count and aren't listed.
//
// privacy: a partner's LinkedIn link is only ever included when this person starred them with
// the ✦ button (the snapshot taken at capture time), same as the recap email.
import { buildPartnerLists } from './recap-partners';

export function buildProfileHistory({
  myParticipants = [],   // [{ id, session_id }] this profile's participant rows, all sessions
  sessions = [],         // [{ id, name, ended_at, created_at }]
  pairings = [],
  rounds = [],
  participants = [],     // every participant row in those sessions: { id, name, kicked_at, profile_id }
  captures = [],         // this profile's captures: { capturer_id, captured_id, captured_linkedin_url }
  noShows = new Set(),
}) {
  const lists = buildPartnerLists({ pairings, rounds, participants, captures, noShows });
  const linkedinBy = new Map();
  for (const c of captures) {
    const url = /^https?:\/\//i.test(c.captured_linkedin_url || '') ? c.captured_linkedin_url : null;
    if (url) linkedinBy.set(`${c.capturer_id}:${c.captured_id}`, url);
  }
  const sessionById = new Map(sessions.map((s) => [s.id, s]));

  const idsBySession = new Map();
  for (const mp of myParticipants) {
    if (!idsBySession.has(mp.session_id)) idsBySession.set(mp.session_id, []);
    idsBySession.get(mp.session_id).push(mp.id);
  }

  let calls = 0;
  const distinct = new Set();
  const out = [];

  for (const [sessionId, ownerIds] of idsBySession) {
    const s = sessionById.get(sessionId);
    if (!s) continue;
    const seenPartners = new Set();
    const partners = [];
    for (const ownerId of ownerIds) {
      for (const p of lists[ownerId] || []) {
        if (seenPartners.has(p.partnerId)) continue;
        seenPartners.add(p.partnerId);
        partners.push({
          name: p.name,
          round: p.round,
          roomLabel: p.roomLabel,
          starred: p.starred,
          linkedinUrl: p.starred ? (linkedinBy.get(`${ownerId}:${p.partnerId}`) || null) : null,
        });
        calls += 1;
        distinct.add(p.partnerProfileId || `name:${p.name.toLowerCase()}`);
      }
    }
    if (partners.length === 0) continue;
    partners.sort((a, b) => (a.round || 0) - (b.round || 0));
    out.push({ sessionId, sessionName: s.name, date: s.ended_at || s.created_at, partners });
  }

  out.sort((a, b) => new Date(b.date) - new Date(a.date));
  return { calls, peopleMet: distinct.size, sessions: out };
}
