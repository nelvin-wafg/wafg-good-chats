// ranks everyone by how many connections they captured, across the sessions passed in.
// shared by the dashboard card (top few) and the "top connectors" window (everyone), so
// the two can never disagree.
//
// a person who joined several sessions is one row when they have a profile; a connector
// with no profile stays one row per participant (they can still be wiped per participant).
export function rankConnectors(captures, participants, profiles) {
  const captureCountByCapturer = {};
  for (const c of captures) {
    captureCountByCapturer[c.capturer_id] = (captureCountByCapturer[c.capturer_id] || 0) + 1;
  }
  const participantById = Object.fromEntries(participants.map((p) => [p.id, p]));
  const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));

  const byKey = {};
  for (const [capturerId, count] of Object.entries(captureCountByCapturer)) {
    const p = participantById[capturerId];
    if (!p) continue;
    const key = p.profile_id || `noprofile-${p.id}`;
    if (!byKey[key]) {
      byKey[key] = {
        // profile_id when we have one · null otherwise
        profile_id: p.profile_id || null,
        participant_id: p.profile_id ? null : p.id,
        name: p.name,
        email: p.profile_id ? profileById[p.profile_id]?.email || null : null,
        captures: 0,
        sessions: 0,
      };
    }
    byKey[key].captures += count;
    byKey[key].sessions += 1; // one participant row per session they joined
  }
  return Object.values(byKey).sort((a, b) => b.captures - a.captures);
}
