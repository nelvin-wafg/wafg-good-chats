// the preview image for a personal invite link (what LinkedIn / X / iMessage show when someone
// pastes it). plain React.createElement (no JSX) so it can also be rendered from a script.
// kept deliberately simple: black card, the inviter's first name, the next call, and the question
// they chose to share (if any). nothing here is typed by a stranger: the name is the inviter's own
// first name, the date comes from the session, the question is a host-written round prompt.
import React from 'react';

const h = React.createElement;
const CYAN = '#01ecf3';

export function inviteImageElement({ first, when, prompt, size = { width: 1200, height: 630 } }) {
  const wide = size.width >= size.height;
  const pad = wide ? 80 : 70;
  const headline = prompt ? 'a question to answer live:' : `${first || 'a friend'} invited you`;
  return h(
    'div',
    { style: { width: size.width, height: size.height, background: '#000', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', padding: pad, color: '#fff', fontFamily: 'sans-serif' } },
    h('div', { style: { display: 'flex', alignItems: 'baseline' } },
      h('span', { style: { fontSize: 54, fontWeight: 900, letterSpacing: -2, color: '#fff' } }, 'good'),
      h('span', { style: { fontSize: 54, fontWeight: 900, color: CYAN } }, '*'),
      h('span', { style: { fontSize: 54, fontWeight: 900, letterSpacing: -2, color: '#fff' } }, 'chats')
    ),
    h('div', { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: { fontSize: prompt ? 34 : 76, fontWeight: 900, color: prompt ? CYAN : '#fff', lineHeight: 1.1, display: 'flex' } }, headline),
      prompt
        ? h('div', { style: { fontSize: wide ? 58 : 54, fontWeight: 900, lineHeight: 1.15, marginTop: 18, display: 'flex' } }, `“${prompt}”`)
        : h('div', { style: { fontSize: 36, marginTop: 20, color: '#d4d4d4', lineHeight: 1.25, display: 'flex' } }, 'six one-on-one conversations in about 45 minutes, with people doing good.')
    ),
    h('div', { style: { display: 'flex', flexDirection: 'column' } },
      h('div', { style: { fontSize: 34, fontWeight: 700, color: CYAN, display: 'flex' } }, prompt ? `${first || 'A friend'} invited you` : (when || 'join the next call')),
      prompt && when ? h('div', { style: { fontSize: 28, color: '#d4d4d4', marginTop: 6, display: 'flex' } }, `next call: ${when}`) : null,
      h('div', { style: { fontSize: 24, color: '#a3a3a3', marginTop: 10, display: 'flex' } }, 'goodchats.weareforgood.com · We Are For Good')
    )
  );
}

// "Fri, Dec 4 · 12:30 PM ET"
export function etWhen(startsAt) {
  const d = startsAt ? new Date(startsAt) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  return `${day} · ${time}`;
}
