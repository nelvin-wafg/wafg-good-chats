// when can participants actually get in? a session with a published start time
// (metadata.starts_at) opens its doors JOIN_EARLY_MS before that time. before that, the
// join link shows a "doors open at ..." page and the join API refuses. a session with
// no start time is never gated (hosts who don't publish a time keep today's behavior).
//
// shared by the join page (server, to pick the first screen), the join form (client, for
// the live countdown) and the join API (server, the part that cannot be bypassed).
export const JOIN_EARLY_MS = 5 * 60 * 1000;

export function joinWindow(startsAt, now = Date.now()) {
  const startsAtMs = startsAt ? new Date(startsAt).getTime() : NaN;
  if (!Number.isFinite(startsAtMs)) {
    return { gated: false, open: true, startsAtMs: null, opensAtMs: null, msUntilOpen: 0 };
  }
  const opensAtMs = startsAtMs - JOIN_EARLY_MS;
  const open = now >= opensAtMs;
  return { gated: true, open, startsAtMs, opensAtMs, msUntilOpen: Math.max(0, opensAtMs - now) };
}

// "3d 4h", "4h 12m", "12m 05s", "45s"
export function formatCountdown(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}
