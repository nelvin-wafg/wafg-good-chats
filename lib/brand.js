// brand tokens for inline styles. tailwind tokens live in tailwind.config.js.
export const brand = {
  cyan: '#01ecf3',
  softCyan: '#54d1de',
  black: '#000000',
  white: '#ffffff',
  warmGray: '#f4f4f1',
  shadowOffset: '6px',
  shadow: '6px 6px 0 #000',
  shadowSm: '4px 4px 0 #000',
  shadowLg: '8px 8px 0 #000',
};

// participant avatar color rotation (consistent per name)
export const avatarColors = [
  '#ffb84d', '#ff7a59', '#b19ff5', '#54d1de',
  '#f8d958', '#f48fb1', '#6dcfb5', '#e0bbff',
];

export function colorForName(name = '') {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return avatarColors[hash % avatarColors.length];
}

export function initials(name = '') {
  // strip non-letter characters first so things like "host (you)" don't produce "h("
  const cleaned = (name || '').toLowerCase().replace(/[^a-z\s]/g, ' ');
  const parts = cleaned.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] + parts[parts.length - 1][0]);
}
