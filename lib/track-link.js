// click tracking for links in our emails. server-only.
//
// a tracked link looks like https://goodchats.weareforgood.com/go/<token>. the token carries the
// real destination, who it was sent to and why, signed with SESSION_SECRET, so:
//   - it can't be turned into an "open redirect": only destinations WE signed will ever be used,
//     and only https links to LinkedIn or our own site
//   - nothing about the recipient is visible in the URL beyond an opaque id
// the /go route records the click and forwards. email scanners that pre-open links show up as
// clicks too; a few known ones are flagged (is_bot) but not all can be told apart, so treat click
// counts as "at most this many people", not exact.
import { signData, verifyData } from './secrets';

const SITE = 'https://goodchats.weareforgood.com';

const b64e = (s) => Buffer.from(s, 'utf-8').toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64d = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4), 'base64').toString('utf-8');
const sign = (p) => signData(`track:${p}`);

export function allowedTarget(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return h === 'linkedin.com' || h.endsWith('.linkedin.com') || h === 'goodchats.weareforgood.com';
  } catch {
    return false;
  }
}

// returns the tracked url, or the original url unchanged if it can't be tracked safely
export function trackedLinkUrl({ url, kind, profileId = null, sessionId = null }) {
  if (!allowedTarget(url)) return url;
  try {
    const payload = b64e(JSON.stringify({ u: url, k: String(kind).slice(0, 40), p: profileId, s: sessionId }));
    return `${SITE}/go/${payload}.${sign(payload)}`;
  } catch {
    return url;
  }
}

export function verifyTrackedLink(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!verifyData(`track:${payload}`, sig)) return null;
  try {
    const d = JSON.parse(b64d(payload));
    if (!d?.u || !allowedTarget(d.u)) return null;
    return { url: d.u, kind: String(d.k || 'link'), profileId: d.p || null, sessionId: d.s || null };
  } catch {
    return null;
  }
}

const BOT_UA = /bot|crawl|spider|preview|slurp|facebookexternalhit|slackbot|whatsapp|telegram|discord|embedly|skypeuripreview|googleimageproxy|mimecast|barracuda|proofpoint|safelinks|python-requests|curl\/|wget|headless/i;
export function isLikelyBot(userAgent) {
  const ua = String(userAgent || '');
  return !ua || BOT_UA.test(ua);
}
