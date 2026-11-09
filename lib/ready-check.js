// the host's "ready check": who might have trouble in round 1, spotted BEFORE the round starts.
//
// on Nov 6 every audio problem in round 1 was already visible in the logs before the round began:
// mic checks that heard nothing, a connection reconnecting every 25 seconds, people who joined seconds
// before the host pressed start. round 1 is just the first time anyone speaks, so that is when
// pre-existing faults became audible. this turns those signals into a short list the host can act on.
//
// pure function: the route does the queries and passes rows in.
export const READY = {
  FLAP_COUNT: 3,            // this many media reconnects ...
  FLAP_WINDOW_MS: 90 * 1000,// ... within this long = "keeps dropping"
  RECENT_JOIN_MS: 90 * 1000,
  STALE_HEARTBEAT_MS: 20 * 1000, // the round route only pairs people seen in the last 20s
  MIC_WINDOW_MS: 120 * 1000,
};

const PRE = {
  silent: 'preflight mic on but silent',
  denied: 'preflight mic permission denied',
  none: 'preflight no microphone found',
  heard: 'preflight mic heard',
  camDenied: 'preflight camera permission denied',
};
const LEVEL_RANK = { bad: 0, warn: 1, info: 2 };
const ts = (v) => (v ? new Date(v).getTime() : NaN);

export function buildReadyCheck({ participants = [], events = [], now = Date.now() }) {
  const present = (participants || []).filter((p) => p.is_present && !p.kicked_at);

  const byPerson = new Map();
  for (const e of events || []) {
    if (!e.participant_id) continue;
    if (!byPerson.has(e.participant_id)) byPerson.set(e.participant_id, []);
    byPerson.get(e.participant_id).push(e);
  }
  for (const list of byPerson.values()) list.sort((a, b) => ts(a.created_at) - ts(b.created_at));

  const people = [];
  for (const p of present) {
    const evs = byPerson.get(p.id) || [];
    const issues = [];

    // 1. waiting-room mic check. the latest result wins: a later "heard you" clears an earlier "silent"
    let audioPre = null;
    let camPre = null;
    for (const e of evs) {
      if (e.event_type !== 'track-state-change') continue;
      const st = e.payload && e.payload.state;
      if (typeof st !== 'string') continue;
      if (e.payload.track === 'audio') {
        if (st === PRE.heard) audioPre = null;
        else if (st === PRE.silent || st === PRE.denied || st === PRE.none) audioPre = st;
      } else if (e.payload.track === 'video' && st === PRE.camDenied) camPre = st;
    }
    if (audioPre === PRE.denied) issues.push({ code: 'mic-denied', level: 'bad', text: 'Browser is blocking their mic', hint: 'They need to click the lock icon in the address bar and allow the mic.' });
    else if (audioPre === PRE.none) issues.push({ code: 'no-mic', level: 'bad', text: 'No microphone found', hint: 'Ask them to plug in a headset, or join from a phone.' });
    else if (audioPre === PRE.silent) issues.push({ code: 'mic-silent', level: 'warn', text: 'Mic check heard nothing', hint: 'Ask them to say hello and test again. They may just not have spoken.' });
    if (camPre) issues.push({ code: 'cam-denied', level: 'info', text: 'Camera is blocked', hint: 'Fine if they prefer audio only.' });

    // 2. what their mic is doing right now (their own report)
    const mics = evs.filter((e) => e.event_type === 'mic-state');
    const lastMic = mics[mics.length - 1];
    if (lastMic && now - ts(lastMic.created_at) <= READY.MIC_WINDOW_MS) {
      const st = lastMic.payload && lastMic.payload.state;
      if (st === 'blocked') issues.push({ code: 'mic-blocked', level: 'bad', text: 'Their mic is blocked', hint: 'The browser or system is stopping the mic. They need to allow it.' });
      else if (st === 'interrupted') issues.push({ code: 'mic-interrupted', level: 'warn', text: 'Their mic cut out', hint: 'Another app may have taken it. Ask them to close other call apps.' });
    }

    // 3. a connection that keeps reconnecting (Nov 6: one every 25 seconds for eight minutes)
    const flaps = evs.filter((e) => e.event_type === 'network-connection'
      && e.payload && e.payload.type === 'sfu' && e.payload.event === 'connected'
      && now - ts(e.created_at) <= READY.FLAP_WINDOW_MS).length;
    if (flaps >= READY.FLAP_COUNT) issues.push({ code: 'unstable', level: 'bad', text: 'Connection keeps dropping', hint: 'Ask them to switch networks (Wi-Fi or cellular) or reload the page.' });

    // 4. no heartbeat: the round route only pairs people seen in the last 20 seconds
    const seen = ts(p.last_seen);
    if (Number.isFinite(seen) && now - seen > READY.STALE_HEARTBEAT_MS) {
      issues.push({ code: 'stale', level: 'bad', text: `No signal for ${Math.round((now - seen) / 1000)}s`, hint: "They won't be paired unless their tab reconnects." });
    }

    // 5. joined moments ago: not settled yet
    const joined = ts(p.joined_at);
    if (Number.isFinite(joined) && now - joined < READY.RECENT_JOIN_MS) {
      issues.push({ code: 'just-joined', level: 'info', text: `Joined ${Math.max(1, Math.round((now - joined) / 1000))}s ago`, hint: 'Give them a moment to settle.' });
    }

    if (issues.length) {
      issues.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
      people.push({ id: p.id, name: p.name, worst: issues[0].level, issues });
    }
  }

  people.sort((a, b) => LEVEL_RANK[a.worst] - LEVEL_RANK[b.worst] || String(a.name).localeCompare(String(b.name)));
  const count = (lvl) => people.filter((x) => x.worst === lvl).length;
  return {
    present: present.length,
    flagged: people.length,
    bad: count('bad'),
    warn: count('warn'),
    info: count('info'),
    // "clear" = nobody needs a conversation before starting (people who only just joined don't block)
    clear: people.every((x) => x.worst === 'info'),
    people,
  };
}
