// who each participant was paired with, for the end-of-session recap email.
//
// the recap used to list only the people someone tapped ✦ on. people forget to
// tap, so this builds the fuller picture: everyone they were paired with, by
// name only (no LinkedIn links · those stay tied to a deliberate capture).
//
// pure functions, no I/O · the end route does the queries and passes rows in.

// rooms where someone waited for a partner and the partner never turned up.
// derived from the 'partner-wait' connection events: a room that has at least
// one 'waiting' event and no 'joined' event is treated as a no-show, so neither
// person is handed a name for someone they never met. best-effort · an empty or
// missing event list simply means nobody is excluded.
export function noShowRooms(events = []) {
  const waiting = new Set();
  const joined = new Set();
  for (const e of events || []) {
    const room = e?.payload?.room;
    if (!room) continue;
    if (e.payload.state === 'waiting') waiting.add(room);
    else if (e.payload.state === 'joined') joined.add(room);
  }
  const out = new Set();
  for (const room of waiting) if (!joined.has(room)) out.add(room);
  return out;
}

// returns { [participantId]: [{ round, roomLabel, name, partnerId, partnerProfileId, starred }] }
// sorted by round. skips sit-outs, no-show rooms and host-removed partners, and
// lists each partner once (earliest round). `starred` marks people the owner
// captured with the ✦ button so the email can show them differently.
export function buildPartnerLists({
  pairings = [],
  rounds = [],
  participants = [],
  captures = [],
  noShows = new Set(),
}) {
  const roundNumber = new Map(rounds.map((r) => [r.id, r.round_number]));
  const byId = new Map(participants.map((p) => [p.id, p]));
  const starred = new Set(captures.map((c) => `${c.capturer_id}:${c.captured_id}`));

  const lists = {};
  const seen = new Set();

  const ordered = [...pairings].sort(
    (a, b) => (roundNumber.get(a.round_id) || 0) - (roundNumber.get(b.round_id) || 0),
  );

  for (const p of ordered) {
    if (!p.participant_a_id || !p.participant_b_id) continue; // sit-out
    if (p.room_name && noShows.has(p.room_name)) continue;

    for (const [ownerId, partnerId] of [
      [p.participant_a_id, p.participant_b_id],
      [p.participant_b_id, p.participant_a_id],
    ]) {
      const partner = byId.get(partnerId);
      if (!partner || partner.kicked_at) continue;
      const name = String(partner.name || '').trim();
      if (!name) continue;
      const key = `${ownerId}:${partnerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      (lists[ownerId] ||= []).push({
        round: roundNumber.get(p.round_id) || null,
        roomLabel: p.room_label || null,
        name,
        partnerId,
        partnerProfileId: partner.profile_id || null,
        starred: starred.has(key),
      });
    }
  }
  return lists;
}
