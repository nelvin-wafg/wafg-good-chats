// The version history of Good Chats. Surfaced through the host dashboard's
// "the story →" link as a horizontal-scroll showcase modal. To add a v4 later,
// drop a new entry at the end and mark its `current` flag true (and unset the
// flag on the previous entry).

export const STORY = [
  {
    id: 'v0',
    label: 'v0',
    era: 'Sketch',
    dateRange: 'Early 2026',
    summary:
      "Designs and brand decisions before any code. Born from the limits of a 10-cap Zoom plus randomizer setup. The vision: a standalone tool with full brand control and real video.",
    features: [
      'Mockups for main room, pair rooms, splitting transitions',
      'Brand decisions: lowercase mark, cyan asterisks, off-white palette',
      'Format premise: auto-rotating timed pairings with prompts',
      'The "capture the connection" idea',
      'Decision to build standalone, not a Zoom plugin',
    ],
    accent: 'sketch',
  },
  {
    id: 'v1',
    label: 'v1',
    era: 'First Build',
    dateRange: 'Spring 2026',
    summary:
      "Stack chosen, app shipped end-to-end. Worked technically but nobody outside the dev loop had touched it. Security baseline locked down from day one.",
    features: [
      'Next.js + Supabase + Daily.co on Vercel',
      'Magic-link host login with approval gate',
      'Pairing algorithm with no-repeats and fair sit-out rotation',
      'Auto-rotating rounds + prompts + with-host slot for odd counts',
      'Main room and pair rooms wired into Daily',
      'Host dashboard and session creation wizard',
      'Deny-by-default RLS, rate-limited APIs, HMAC participant cookies',
    ],
    accent: 'built',
  },
  {
    id: 'v2',
    label: 'v2',
    era: 'First Live Event',
    dateRange: 'Late spring 2026',
    summary:
      "Hardened for the first real session. Profiles, recap, Kit, co-host, light WAFG palette. May 2026: twelve people, six rounds, real conversations. It mostly worked.",
    features: [
      'Profiles keyed by email + returning-user recognition',
      'LinkedIn URLs shown in pair rooms',
      'Post-event recap with capture counts',
      'Kit newsletter integration',
      'Co-host support for Jon and Becky',
      'Analytics page with sparklines and top-connector list',
      'Two-way pair room chat',
      'Light WAFG palette across main and pair rooms',
      'Rebrand: "Spread Good Chats" → "Good Chats"',
    ],
    accent: 'refined',
  },
  {
    id: 'v3',
    label: 'v3',
    era: 'Built for Scale',
    dateRange: 'June 2026',
    summary:
      "Everything that came out of the first event debrief. Bug fixes, video polish, mid-round controls, waiting room, two-way help. Plus opening the project to the public.",
    features: [
      'Bug fixes: phantom names, duplicate rejoins, iOS audio playback, heartbeat-DB sync',
      'Round auto-advance via server-time heartbeat (survives a backgrounded host tab)',
      'Video polish: bigger labels, three view modes, device switcher, own LinkedIn',
      'Mid-round control: orphan handling, place-into-room, host kick, host broadcast',
      'Flag/SOS with audible chime and two-way help thread',
      'Waiting room: admit individually or all at once',
      'Dashboard drill-downs: clickable stat cards with detail modals',
      'Public landing page + notify-list signup tagged to Kit',
    ],
    accent: 'current',
    current: true,
  },
];
