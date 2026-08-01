// lightweight, deliberately small blocklist for participant display names.
// intent is to catch obvious cases in a professional community-networking
// context, not to be a comprehensive moderation system — host can still end
// a session early for anything this misses (see docs/SECURITY.md §12).
// deliberately excludes terms that double as common given names (e.g. "dick")
// to avoid false-flagging real people's names.
const BLOCKED_TERMS = [
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'pussy', 'faggot',
  'nigger', 'nigga', 'retard', 'whore', 'slut',
];

// normalize away spaces/punctuation/leet-speak substitutions so "f u c k" or
// "f4ggot" still match, without being so aggressive it flags unrelated words.
function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[0-9]/g, (d) => ({ '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't' }[d] || d))
    .replace(/[^a-z]/g, '');
}

export function containsBlockedTerm(text) {
  const normalized = normalize(text);
  return BLOCKED_TERMS.some((term) => normalized.includes(term));
}
