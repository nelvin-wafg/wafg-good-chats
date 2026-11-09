'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { googleCalendarUrl, buildIcs } from '@/lib/calendar';

// what a stranger sees when a friend sends them a personal invite link. one job: make the next
// call feel easy and a little intriguing, then get them in with as few fields as possible.
export default function InviteLanding({ code, first, next, prompt }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [linkedin, setLinkedin] = useState('');
  const [showLinkedin, setShowLinkedin] = useState(false);
  const [alsoNotify, setAlsoNotify] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | busy | done | open | error
  const [message, setMessage] = useState('');

  // tell the server this browser arrived through this link (done in the browser so link-preview
  // bots and email scanners don't count as visits)
  useEffect(() => {
    fetch('/api/referrals/visit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
      body: JSON.stringify({ code }),
    }).catch(() => {});
  }, [code]);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://goodchats.weareforgood.com';
  const startMs = next?.startsAt ? new Date(next.startsAt).getTime() : NaN;
  const hasTime = Number.isFinite(startMs);
  const when = hasTime
    ? new Date(startMs).toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : null;

  async function submit(e) {
    e.preventDefault();
    if (status === 'busy') return;
    setStatus('busy'); setMessage('');
    try {
      const res = next
        ? await fetch(`/api/sessions/${next.id}/rsvp`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ email: email.trim(), firstName: name.trim() || undefined, joinNotifyList: alsoNotify }),
          })
        : await fetch('/api/notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin',
            body: JSON.stringify({ email: email.trim(), firstName: name.trim(), linkedinUrl: linkedin.trim() || undefined, requireLinkedin: false, source: `invite from ${first}`, subscribeToWeekly: false }),
          });
      if (res.ok) { setStatus('done'); return; }
      if (res.status === 409) { setStatus('open'); return; }
      setStatus('error');
      setMessage((await res.text()) || "couldn't save that · try again");
    } catch {
      setStatus('error'); setMessage('connection issue · try again');
    }
  }

  function downloadIcs() {
    const ics = buildIcs({ name: next.name, code: next.code, startsAt: next.startsAt, durationMin: next.durationMin, origin });
    if (!ics) return;
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `${next.code}.ics`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const gcal = next && hasTime ? googleCalendarUrl({ name: next.name, code: next.code, startsAt: next.startsAt, durationMin: next.durationMin, origin }) : null;
  const input = 'w-full border-2 border-black rounded px-3 py-2.5 text-sm focus:outline-none focus:ring-2';

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-lg">
        <div className="display text-3xl mb-5">good<span style={{ color: '#01ecf3' }}>*</span>chats</div>

        <h1 className="display text-4xl leading-tight">{first} invited you.</h1>
        <p className="text-neutral-700 mt-3 text-lg">
          six one-on-one conversations in about 45 minutes, with people doing good. joyful, energetic, and over before you know it.
        </p>

        {prompt && (
          <div className="mt-5 rounded-md p-4 border-2 border-black" style={{ background: 'rgba(1,236,243,0.18)' }}>
            <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-600 mb-1">a question from last time</div>
            <div className="display text-xl">"{prompt}"</div>
            <p className="text-sm text-neutral-700 mt-1">{first} wants to hear your answer. you'll get to give it, live.</p>
          </div>
        )}

        <div className="mt-6 bg-white rounded-md border-2 border-black p-5" style={{ boxShadow: '4px 4px 0 #000' }}>
          {status === 'done' ? (
            <>
              <div className="display text-2xl">{next ? "you're in." : "you're on the list."} <span style={{ color: '#01ecf3' }}>*</span></div>
              <p className="text-sm text-neutral-700 mt-1">
                {next ? "check your email for a confirmation. the room opens 5 minutes before we start." : `we just sent you a note from ${first}'s invite. you'll get one more email, when the next call is on the calendar.`}
              </p>
              {next && hasTime && (
                <div className="flex flex-wrap gap-2 mt-3">
                  {gcal && <a href={gcal} target="_blank" rel="noopener noreferrer" className="border-2 border-black rounded-md px-3 py-1.5 text-xs font-bold no-underline text-black">add to google calendar</a>}
                  <button type="button" onClick={downloadIcs} className="border-2 border-black rounded-md px-3 py-1.5 text-xs font-bold">apple / outlook (.ics)</button>
                </div>
              )}
            </>
          ) : next && (next.canJoinNow || status === 'open') ? (
            <>
              <div className="display text-2xl">{next.name}</div>
              <p className="text-sm text-neutral-700 mt-1">the room is open right now.</p>
              <a href={`/r/${next.code}`} className="inline-block mt-3 bg-black text-white font-bold rounded-md px-5 py-2.5 text-sm no-underline">join now →</a>
            </>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">next call</div>
                {next ? (
                  <>
                    <div className="display text-2xl">{next.name}</div>
                    {when && <div className="text-sm text-neutral-700">{when}</div>}
                  </>
                ) : (
                  <p className="text-sm text-neutral-700 mt-1">no call on the calendar yet. leave your email and we'll send <strong>one</strong> note when the next one is scheduled.</p>
                )}
              </div>
              <input className={input} placeholder="first name" value={name} onChange={(e) => setName(e.target.value)} required={!next} autoComplete="given-name" maxLength={48} />
              <input className={input} type="email" required placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              {!next && (showLinkedin ? (
                <input className={input} placeholder="your LinkedIn (optional, so people know who they're meeting)" value={linkedin} onChange={(e) => setLinkedin(e.target.value)} />
              ) : (
                <button type="button" onClick={() => setShowLinkedin(true)} className="text-xs underline text-neutral-500 hover:text-black">+ add your LinkedIn (optional)</button>
              ))}
              {next && (
                <label className="flex items-start gap-2 text-xs text-neutral-600 cursor-pointer">
                  <input type="checkbox" checked={alsoNotify} onChange={(e) => setAlsoNotify(e.target.checked)} className="mt-0.5" />
                  <span>also let me know when future calls are scheduled</span>
                </label>
              )}
              {status === 'error' && <p className="text-sm text-red-600">{message}</p>}
              <button type="submit" disabled={status === 'busy' || !email.trim()} className="w-full bg-black text-white font-bold rounded-md py-3 disabled:opacity-50">
                {status === 'busy' ? 'saving...' : next ? 'save my spot →' : 'tell me when it\'s scheduled →'}
              </button>
              <p className="text-[11px] text-neutral-500">no account, no password. we'll email a confirmation{next ? ' and a reminder' : ''}.</p>
            </form>
          )}
        </div>

        <p className="text-xs text-neutral-500 mt-6">
          already been to one? <Link href="/signin" className="underline">sign in</Link> · <Link href="/" className="underline">what is Good Chats?</Link>
        </p>
      </div>
    </main>
  );
}
