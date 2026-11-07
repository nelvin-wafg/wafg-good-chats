// video tile layouts for the main room (participants and the host console share these, so the
// two views can't drift apart).
//
//   gallery  the default · a grid of good-size faces (about 3 across on a laptop)
//   speaker  whoever is talking, large, with a strip of small faces underneath
//   large    bigger faces, about 2 across
//   small    everyone on screen at once · small faces, so name and badge shrink to fit
//
// the face is the point of a tile: the name sits in a small translucent label in the corner and
// there is one small LinkedIn badge in the opposite corner (see DailyVideoTile).
export const VIEW_MODES = ['gallery', 'speaker', 'large', 'small'];

export function isViewMode(m) {
  return VIEW_MODES.includes(m);
}

// minimum tile width for the grid layouts
export function minTileFor(mode) {
  if (mode === 'large') return '340px';
  if (mode === 'small') return '150px';
  return '220px';
}

// tiles this small get a smaller label and badge
export function isCompactMode(mode) {
  return mode === 'small';
}
