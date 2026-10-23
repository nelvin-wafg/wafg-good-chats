'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { joinWindow, formatCountdown } from '@/lib/join-window';

export default function JoinForm({ session, knownProfile, serverNow }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?removed=1 means the host kicked us · show a soft explanation rather than
  // letting the person wonder why they ended up back on the join screen.
  const wasRemoved = searchParams?.get('removed') === '1';

  // form state · prefill from known profile if present
  const [name, setName] = useState(knownProfile?.displayName || '');
  const [email, setEmail] = useState(knownProfile?.email || '');
  const [linkedinUrl, setLinkedinUrl] = useState(knownProfile?.linkedinUrl || '');
  // unchecked by default for new users (affirmative opt-in · GDPR-friendly).
  // returning users keep their previous choice.
  const [newsletterOptIn, setNewsletterOptIn] = useState(
    knownProfile ? Boolean(knownProfile.newsletterOptIn) : false
  );
  const [showFull, setShowFull] = useState(!knownProfile); // returning users see compact view first
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [recognized, setRecognized] = useState(false); // after email lookup match
  const lookupTimer = useRef(null);

  // the join window (see lib/join-window.js): doors open 5 minutes before the published
  // start. `now` runs on the SERVER's clock. it starts at serverNow (the same value on the
  // server and the client, so there's no hydration mismatch), then ticks forward using the
  // server/browser offset, so a participant whose computer clock is wrong can't see the
  // doors open early or late. the join API enforces the same rule, this is just the UX.
  const earlyPreview = searchParams?.get('early') === '1'; // approved hosts only; the API verifies
  const [now, setNow] = useState(serverNow || Date.now());
  const [mounted, setMounted] = useState(false);
  const [serverSaysEarly, setServerSaysEarly] = useState(false);
  useEffect(() => {
    setMounted(true);
    const offset = (serverNow || Date.now()) - Date.now();
    const tick = () => setNow(Date.now() + offset);
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [serverNow]);
  const win = joinWindow(session.startsAt, now);
  const showNotOpen = win.gated && (serverSaysEarly || (!win.open && !earlyPreview));
  const eyebrow = win.gated && now < win.startsAtMs ? 'Good Chats · doors are open' : 'Good Chats · happening now';
  const previewNote = earlyPreview && win.gated && !win.open ? (
    <div className="mb-4 rounded-md p-3 border-2 text-xs" style={{ background: 'rgba(1,236,243,0.12)', borderColor: '#01ecf3' }}>
      host preview · this session isn't open to participants yet. they'll see a "doors open" page until 5 minutes before it starts.
    </div>
  ) : null;

  // when a first-time user types an email and it matches a known profile, autofill
  async function lookupOnBlur() {
    if (!email || knownProfile) return;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
    try {
      const res = await fetch('/api/profiles/lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, sessionId: session.id }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.found && data.profile) {
        // lookup only returns a bare name now (see /api/profiles/lookup) · linkedin
        // and newsletter prefs aren't exposed to an unauthenticated email check.
        setName(data.profile.display_name || '');
        setRecognized(true);
      } else {
        setRecognized(false);
      }
    } catch {}
  }

  async function handleJoin(e) {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          linkedinUrl: linkedinUrl.trim() || null,
          newsletterOptIn,
          hostPreview: earlyPreview,
        }),
      });
      if (res.status === 425) {
        // the server says the doors aren't open (e.g. a non-host used ?early=1). show the
        // "doors open" screen instead of an error.
        setServerSaysEarly(true);
        setSubmitting(false);
        return;
      }
      if (!res.ok) {
        setError(await res.text());
        setSubmitting(false);
        return;
      }
      try {
        window.sessionStorage.setItem(`pname:${session.id}`, name.trim());
      } catch {}
      router.push(`/r/${session.code}/room`);
    } catch (err) {
      setError("couldn't join · try again in a sec.");
      setSubmitting(false);
    }
  }

  if (showNotOpen) {
    return <NotOpenYet session={session} win={win} now={now} mounted={mounted} />;
  }

  // ─── COMPACT WELCOME-BACK VIEW ───
  if (knownProfile && !showFull) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
        <div className="w-full max-w-md">

          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-1">{eyebrow}</div>
            <div className="display text-4xl">{session.name}</div>
          </div>

          {previewNote}

          {wasRemoved && (
            <div className="mb-4 rounded-md p-4 border-2" style={{ background: 'rgba(220, 38, 38, 0.05)', borderColor: '#dc2626' }}>
              <div className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#dc2626' }}>* removed from session *</div>
              <p className="text-sm text-neutral-700">the host removed you from this session. if you think this was a mistake, you can rejoin below.</p>
            </div>
          )}

          <form onSubmit={handleJoin} className="sticker bg-white rounded-md p-6 mb-4">
            <div className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: '#01ecf3' }}>welcome back</div>
            <div className="display text-3xl mb-1">{knownProfile.displayName} *</div>
            <div className="text-sm text-neutral-500 mb-4">{knownProfile.email}</div>
            {knownProfile.linkedinUrl && (
              <div className="text-xs text-neutral-500 mb-4 truncate font-mono">{knownProfile.linkedinUrl}</div>
            )}
            <button
              type="submit"
              disabled={submitting}
              className="w-full btn-cyan py-4 text-xl rounded-md disabled:opacity-50"
            >
              {submitting ? 'warming things up...' : "i'm in *"}
            </button>
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
          </form>

          <div className="text-center text-sm flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => { setShowFull(true); setRecognized(true); }}
              className="underline text-neutral-600 hover:text-black"
            >
              edit my info
            </button>
            <span className="text-neutral-400">·</span>
            <button
              type="button"
              onClick={() => {
                // clear values for a different account
                setShowFull(true);
                setRecognized(false);
                setName('');
                setEmail('');
                setLinkedinUrl('');
                setNewsletterOptIn(false);
              }}
              className="underline text-neutral-600 hover:text-black"
            >
              not me · use a different account
            </button>
          </div>

          <p className="text-xs text-neutral-500 mt-6 text-center">
            [need to leave early? totally fine. just close the tab.]
          </p>
        </div>
      </main>
    );
  }

  // ─── FULL FORM VIEW ───
  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md">

        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-1">{eyebrow}</div>
          <div className="display text-4xl">{session.name}</div>
        </div>

        {previewNote}

        {wasRemoved && (
          <div className="mb-4 rounded-md p-4 border-2" style={{ background: 'rgba(220, 38, 38, 0.05)', borderColor: '#dc2626' }}>
            <div className="text-xs uppercase tracking-widest font-bold mb-1" style={{ color: '#dc2626' }}>* removed from session *</div>
            <p className="text-sm text-neutral-700">the host removed you from this session. if you think this was a mistake, you can rejoin below.</p>
          </div>
        )}

        <form onSubmit={handleJoin} className="sticker bg-white rounded-md p-6 mb-6">

          <label className="block mb-4">
            <div className="text-sm font-semibold mb-1">your email</div>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setRecognized(false); }}
              onBlur={lookupOnBlur}
              placeholder="you@yourwork.com"
              className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
              required
              autoComplete="email"
            />
            {recognized && (
              <p className="text-xs mt-1.5" style={{ color: '#01ecf3' }}>* we know you · welcome back</p>
            )}
          </label>

          <label className="block mb-4">
            <div className="text-sm font-semibold mb-1">what should we call you?</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="your name"
              className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
              maxLength={48}
              required
              autoComplete="name"
            />
          </label>

          <label className="block mb-4">
            <div className="text-sm font-semibold mb-1">linkedin</div>
            <input
              type="text"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.target.value)}
              placeholder="linkedin.com/in/your-profile"
              className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
              maxLength={200}
              required
            />
            <p className="text-xs text-neutral-500 mt-1.5">[shown to people you're paired with so they can connect]</p>
          </label>

          <label className="flex items-start gap-2 mb-4 cursor-pointer">
            <input
              type="checkbox"
              checked={newsletterOptIn}
              onChange={(e) => setNewsletterOptIn(e.target.checked)}
              className="mt-1 w-4 h-4 accent-wafg-cyan"
            />
            <span className="text-sm">add me to the WAFG newsletter <span className="text-neutral-500">[unsubscribe anytime]</span></span>
          </label>

          <button
            type="submit"
            disabled={submitting || !name.trim() || !email.trim() || !linkedinUrl.trim()}
            className="w-full btn-cyan py-4 text-xl rounded-md disabled:opacity-50"
          >
            {submitting ? 'warming things up...' : "i'm in *"}
          </button>

          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </form>

        <div className="bg-black text-white rounded-md p-5">
          <div className="text-xs uppercase tracking-widest font-bold mb-3" style={{ color: '#01ecf3' }}>here's the vibe</div>
          <ul className="space-y-2 text-sm">
            <li><span style={{ color: '#01ecf3', fontFamily: 'var(--font-display)' }}>*</span> {session.rounds_total} rounds · {Math.round(session.round_seconds / 60)} min each</li>
            <li><span style={{ color: '#01ecf3', fontFamily: 'var(--font-display)' }}>*</span> we'll all hang together first · then split into pairs</li>
            <li><span style={{ color: '#01ecf3', fontFamily: 'var(--font-display)' }}>*</span> a prompt drops each round · use it or don't</li>
            <li><span style={{ color: '#01ecf3', fontFamily: 'var(--font-display)' }}>*</span> tap the heart if you want to stay in touch with someone</li>
          </ul>
        </div>

        <p className="text-xs text-neutral-500 mt-6 text-center">
          [need to leave early? totally fine. just close the tab.]
        </p>
      </div>
    </main>
  );
}

// ─── "NOT OPEN YET" SCREEN ───
// shown instead of the join form until the doors open (5 minutes before the published
// start). the announcement email's "save your spot" lands here, so it has to make sense on
// its own: what it is, when it starts, when you can get in, and a one-tap way to save it.
function NotOpenYet({ session, win, now, mounted }) {
  const startsAt = new Date(win.startsAtMs);
  const opensAt = new Date(win.opensAtMs);
  const fmtWhen = (d) => d.toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const fmtCal = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

  // end of the calendar block: the rounds themselves plus ~10 minutes of hanging out
  const roundsMin = Math.round(((session.rounds_total || 0) * (session.round_seconds || 0)) / 60);
  const endsAt = new Date(win.startsAtMs + Math.max(30, roundsMin + 10) * 60 * 1000);
  const joinUrl = typeof window !== 'undefined' ? `${window.location.origin}/r/${session.code}` : `/r/${session.code}`;
  const details = `Seven-minute conversations, on purpose.\nJoin here: ${joinUrl}\nThe room opens 5 minutes before the start.`;

  const googleUrl =
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(session.name)}` +
    `&dates=${fmtCal(startsAt)}/${fmtCal(endsAt)}` +
    `&details=${encodeURIComponent(details)}` +
    `&location=${encodeURIComponent(joinUrl)}`;

  function downloadIcs() {
    const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//We Are For Good//Good Chats//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${session.code}-${win.startsAtMs}@goodchats.weareforgood.com`,
      `DTSTAMP:${fmtCal(new Date())}`,
      `DTSTART:${fmtCal(startsAt)}`,
      `DTEND:${fmtCal(endsAt)}`,
      `SUMMARY:${esc(session.name)}`,
      `DESCRIPTION:${esc(details)}`,
      `URL:${joinUrl}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT10M',
      'ACTION:DISPLAY',
      'DESCRIPTION:Good Chats starts soon',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${session.code}.ics`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md text-center">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-2">Good Chats · coming up</div>
        <div className="display text-5xl mb-3">{session.name}</div>
        <p className="text-lg text-neutral-700 mb-6" style={{ minHeight: '1.75rem' }}>
          {mounted ? <>starts <strong>{fmtWhen(startsAt)}</strong></> : ' '}
        </p>

        <div className="sticker bg-white rounded-md p-6 mb-5">
          <div className="text-xs uppercase tracking-widest font-bold mb-2" style={{ color: '#01ecf3' }}>doors open in</div>
          <div className="display text-5xl mb-3" aria-live="off">{formatCountdown(win.msUntilOpen)}</div>
          <p className="text-sm text-neutral-600">
            {mounted ? <>you can join from <strong>{fmtTime(opensAt)}</strong>, 5 minutes before we start. </> : null}
            leave this page open and it will let you in on its own.
          </p>
        </div>

        <div className="flex items-center justify-center gap-3 mb-6">
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-cyan px-5 py-3 text-sm rounded-md no-underline"
          >
            add to google calendar *
          </a>
          <button
            type="button"
            onClick={downloadIcs}
            className="px-5 py-3 text-sm rounded-md border-2 border-black bg-white hover:bg-neutral-100 font-semibold"
          >
            apple / outlook (.ics)
          </button>
        </div>

        <p className="text-xs text-neutral-500">
          [{session.rounds_total} rounds · {Math.round((session.round_seconds || 0) / 60)} min each · one good person at a time]
        </p>
        <a href="/" className="inline-block mt-6 text-sm underline text-neutral-600">back home</a>
      </div>
    </main>
  );
}
