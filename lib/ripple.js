// "ripple levels" · the fun layer on the profile page. a person's level comes from how many
// calls (real pairings that actually happened) they've been on, across every session.
//
// thresholds are the same ladder used in the other WAFG app. 0 calls = no level yet.
// the emoji are a first pass · swap freely, nothing else depends on them.
export const RIPPLE_LEVELS = [
  { name: 'The Spark', calls: 1, emoji: '✨' },
  { name: 'First Wave', calls: 3, emoji: '🌊' },
  { name: 'Connector', calls: 5, emoji: '🔗' },
  { name: 'Bridge Builder', calls: 10, emoji: '🌉' },
  { name: 'Catalyst', calls: 20, emoji: '⚡' },
  { name: 'Ripple Maker', calls: 35, emoji: '💧' },
  { name: 'Force for Good', calls: 52, emoji: '🌍' },
];

// returns { count, level, next, toNext, progress }
//   level    the highest level reached, or null at 0 calls
//   next     the next level up, or null at the top
//   toNext   calls still needed for `next` (0 at the top)
//   progress 0..1 across the gap from the current level to the next (1 at the top)
export function rippleFor(callCount) {
  const count = Math.max(0, Math.floor(Number(callCount) || 0));
  let level = null;
  let next = null;
  for (const l of RIPPLE_LEVELS) {
    if (count >= l.calls) level = l;
    else { next = l; break; }
  }
  if (!next) return { count, level, next: null, toNext: 0, progress: 1 };
  const from = level ? level.calls : 0;
  const progress = (count - from) / (next.calls - from);
  return { count, level, next, toNext: next.calls - count, progress };
}
