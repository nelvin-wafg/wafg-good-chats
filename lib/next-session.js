// which session is "the next one"? one rule, shared by the homepage (/api/landing) and the
// profile's next-call card, so they can never disagree.
//
// a session counts when it is published (metadata.is_published), not ended, and not a leftover
// draft whose start time passed more than 12 hours ago. soonest start first; sessions without a
// start time come after, newest first.
export const STALE_DRAFT_MS = 12 * 60 * 60 * 1000;

export function pickNextSession(rows, now = Date.now()) {
  const list = Array.isArray(rows) ? rows : [];
  const published = list.filter((s) => s?.metadata?.is_published === true);
  const upcoming = published.filter((s) => {
    if (s.status !== 'draft') return true;
    const t = s.metadata?.starts_at ? new Date(s.metadata.starts_at).getTime() : NaN;
    return !(Number.isFinite(t) && now - t > STALE_DRAFT_MS);
  });
  const withStart = upcoming.filter((s) => s.metadata?.starts_at);
  const withoutStart = upcoming.filter((s) => !s.metadata?.starts_at);
  withStart.sort((a, b) => new Date(a.metadata.starts_at).getTime() - new Date(b.metadata.starts_at).getTime());
  withoutStart.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  return { chosen: withStart[0] || withoutStart[0] || null, published, upcoming };
}
