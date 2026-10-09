// normalizes daily-js's `network-quality-change` event into a small loggable payload.
//
// the event's shape depends on the installed daily-js version: 0.71 (what package.json's
// ^0.71.0 resolves to) emits `threshold` ('good' | 'low' | 'very-low') and a numeric
// `quality`; 0.77+ emits `networkState` ('good' | 'low' | 'bad') + `networkStateReasons`
// and deprecates the old pair. the first live event logged every one of these as `{}`
// because we only read the 0.77+ names, so read both and keep whichever exists.
export function networkQualityPayload(ev) {
  const state = ev?.networkState || ev?.threshold || null;
  const payload = { state };
  if (typeof ev?.quality === 'number') payload.quality = Math.round(ev.quality);
  if (Array.isArray(ev?.networkStateReasons) && ev.networkStateReasons.length) {
    payload.reasons = ev.networkStateReasons.slice(0, 6);
  }
  return payload;
}

// true only when the quality STATE changed since `lastState`. daily emits this event
// on every quality sample (one connection logged ~45 in two minutes), so logging every
// emission buried real signal and filled the log's 100-row window in about a minute.
export function isNetworkStateChange(lastState, payload) {
  return Boolean(payload.state) && payload.state !== lastState;
}

export const BAD_NETWORK_STATES = new Set(['low', 'very-low', 'bad']);
