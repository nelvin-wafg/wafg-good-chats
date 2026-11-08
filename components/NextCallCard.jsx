'use client';
import { useEffect, useState } from 'react';
import { formatCountdown } from '@/lib/join-window';
import { googleCalendarUrl, buildIcs } from '@/lib/calendar';
import { showToast } from '@/components/Toast';

// the profile's "next call" card · one place to see when the next Good Chats is and do the one
// thing that makes sense right now: save a spot, add it to a calendar, or walk in. when nothing
// is scheduled it says so and offers the notify list.
export default function NextCallCard({ profile }) {
  const [d, setD] = useState(undefined); // undefined = loading, null = couldn't load
  const [offset, setOffset] = useState(0); // server clock minus this computer's clock
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/profiles/next-call', { credentials: 'same-origin', cache: 'no-store' });
      if (!res.ok) { setD(null); return; }
      const j = await res.json();
      setOffset((j.serverNow || Date.now()) - Date.now());
      setD(j);
    } catch {
      setD(null);
    }
  }
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const first = (profile?.displayName || '').trim().split(/\s+/)[0] || '';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://goodchats.weareforgood.com';
  const serverNow = now + offset;

  async function saveSpot() {
    if (busy || !d?.next) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${d.next.id}/rsvp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: profile.email, firstName: first || undefined }),
      });
      if (res.ok) { showToast("you're in · we emailed you a confirmation", 'success'); await load(); }
      else if (res.status === 409) { await load(); }
      else showToast((await res.text()) || "couldn't save your spot", 'error');
    } catch {
      showToast('connection issue · try again', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function toggleNotify() {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch('/api/profiles/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ on: !d.onNotifyList }),
      });
      if (res.ok) {
        const j = await res.json();
        setD((x) => ({ ...x, onNotifyList: j.onNotifyList }));
        showToast(j.onNotifyList ? "you're on the list" : "you're off the list", 'success');
      } else showToast((await res.text()) || "couldn't update that", 'error');
    } catch {
      showToast('connection issue · try again', 'error');
    } finally {
      setBusy(false);
    }
  }

  function downloadIcs(next) {
    const ics = buildIcs({ name: next.name, code: next.code, startsAt: next.startsAt, durationMin: next.durationMin, origin });
    if (!ics) return;
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${next.code}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const shell = (children) => (
    <div className="bg-white rounded-md border-2 border-black p-5 mb-6" style={{ boxShadow: '4px 4px 0 #000' }}>
      <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-2">your next call</div>
      {children}
    </div>
  );

  if (d === undefined) return shell(<p className="text-sm text-neutral-500">[checking the calendar...]</p>);
  if (d === null) return shell(<p className="text-sm text-neutral-500">couldn't load the next call just now · try refreshing.</p>);

  // nothing scheduled: say so, and offer the list
  if (!d.next) {
    return shell(
      <>
        <div className="display text-2xl">no call scheduled yet <span style={{ color: '#01ecf3' }}>*</span></div>
        <p className="text-sm text-neutral-600 mt-1">
          {d.onNotifyList
            ? "you're on the list: we'll email you the moment the next one is on the calendar."
            : "want a heads-up when the next one is scheduled? we'll send one email, no spam."}
        </p>
        <button type="button" onClick={toggleNotify} disabled={busy}
                className={`mt-3 rounded-md px-4 py-2 text-sm font-bold disabled:opacity-50 ${d.onNotifyList ? 'border-2 border-black bg-white' : 'bg-black text-white'}`}>
          {busy ? '...' : d.onNotifyList ? 'turn off heads-ups' : 'email me when it\'s scheduled →'}
        </button>
      </>
    );
  }

  const n = d.next;
  const startsMs = n.startsAt ? new Date(n.startsAt).getTime() : NaN;
  const hasTime = Number.isFinite(startsMs);
  const local = hasTime
    ? new Date(startsMs).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : null;
  let tzNote = null;
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (hasTime && tz !== 'America/New_York') {
      tzNote = new Date(startsMs).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    }
  } catch {}
  const isLive = n.status === 'running_round' || n.status === 'closing';
  const until = hasTime ? startsMs - serverNow : null;
  const gcal = hasTime ? googleCalendarUrl({ name: n.name, code: n.code, startsAt: n.startsAt, durationMin: n.durationMin, origin }) : null;

  return shell(
    <>
      <div className="display text-2xl">{n.name}</div>
      {local && <div className="text-sm text-neutral-700 mt-0.5">{local}{tzNote ? ` · ${tzNote}` : ''}</div>}
      <div className="text-sm font-semibold mt-1" style={{ color: '#00838f' }}>
        {isLive ? 'happening now' : until != null && until > 0 ? `starts in ${formatCountdown(until)}` : n.canJoinNow ? 'the room is open' : ''}
      </div>

      {n.canJoinNow ? (
        <a href={`/r/${n.code}`} className="inline-block mt-3 bg-black text-white font-bold rounded-md px-5 py-2.5 text-sm no-underline">
          {isLive ? 'join now (in progress) →' : 'join now →'}
        </a>
      ) : d.saved ? (
        <>
          <p className="text-sm mt-3"><span className="font-bold">you're in.</span> doors open {n.doorsOpenAt ? new Date(n.doorsOpenAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '5 minutes before'}; this page turns into a join button then.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            {gcal && <a href={gcal} target="_blank" rel="noopener noreferrer" className="border-2 border-black rounded-md px-3 py-1.5 text-xs font-bold no-underline text-black">add to google calendar</a>}
            {hasTime && <button type="button" onClick={() => downloadIcs(n)} className="border-2 border-black rounded-md px-3 py-1.5 text-xs font-bold">apple / outlook (.ics)</button>}
            <a href={`/r/${n.code}`} className="border-2 border-neutral-300 rounded-md px-3 py-1.5 text-xs font-bold no-underline text-neutral-700">join page</a>
          </div>
        </>
      ) : (
        <>
          <button type="button" onClick={saveSpot} disabled={busy} className="mt-3 bg-black text-white font-bold rounded-md px-5 py-2.5 text-sm disabled:opacity-50">
            {busy ? 'saving...' : 'save my spot →'}
          </button>
          <p className="text-xs text-neutral-500 mt-2">one tap · we'll email you a confirmation and a reminder.</p>
        </>
      )}
    </>
  );
}
