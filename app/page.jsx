'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// Public landing page for Good Chats. Three jobs:
//  1. Explain what this is (hero + why + how it works).
//  2. Surface the next session when the host has published one.
//  3. Let visitors join the notify list (→ Kit, tagged "good-chats-lead").
// Session links remain open · this page is about discovery, not gatekeeping.

export default function Landing() {
  const [nextSession, setNextSession] = useState(null);
  const [loadedNext, setLoadedNext] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/landing')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        setNextSession(d?.next || null);
        setLoadedNext(true);
      })
      .catch(() => { if (!cancelled) setLoadedNext(true); });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="min-h-screen" style={{ background: '#f4f4f1', color: '#000' }}>

      {/* hero · fills the viewport · centered so it's the first and almost only
          thing visible above the fold */}
      <section className="min-h-screen flex flex-col items-center justify-center px-6 md:px-12 text-center">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-4">
          We Are For Good
        </div>
        <h1 className="display text-7xl md:text-9xl leading-none mb-6">
          Good<span style={{ color: '#01ecf3' }}>*</span>Chats
        </h1>
        <p className="text-xl md:text-2xl text-neutral-700">
          Seven-minute conversations, on purpose.
          <br />
          One good person at a time.
        </p>
      </section>

      {/* next session card · only renders when there is one to surface */}
      {loadedNext && nextSession && (
        <section className="px-6 md:px-12 pb-12 max-w-3xl mx-auto">
          <NextSessionCard session={nextSession} />
        </section>
      )}

      {/* why */}
      <section className="px-6 md:px-12 py-12 md:py-16 max-w-3xl mx-auto text-center">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-3">
          Why this exists
        </div>
        <div className="display text-3xl md:text-5xl mb-6 leading-tight">
          The world gets better when good people find each other.
        </div>
        <div className="space-y-4 text-lg text-neutral-700">
          <p>
            Good Chats is built on a simple bet. The right seven-minute conversation, with the right person, at the right moment, can ripple further than a year of trying to set up the meeting.
          </p>
          <p>
            The We Are For Good community is full of people doing real work in their own corner of the world. Nonprofit leaders. Community builders. Impact storytellers. Funders. Founders. Designers. The kind of folks you keep meaning to introduce yourself to but never quite do.
          </p>
          <p className="display text-2xl md:text-3xl pt-2" style={{ color: '#000' }}>
            Good Chats is the introduction.
          </p>
        </div>
      </section>

      {/* how it works · three steps + a wide "what comes next" reward banner
          tucked inside the same section so it reads as the continuation of the
          steps, not a separate chapter */}
      <section className="px-6 md:px-12 py-12 md:py-16 max-w-4xl mx-auto">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-3 text-center">
          How it works
        </div>
        <div className="display text-3xl md:text-4xl mb-10 text-center">
          Three steps. One small commitment.
        </div>
        <ol className="grid md:grid-cols-3 gap-5">
          <HowStep n="1" title="Drop your email">
            We'll tell you when the next session is happening.
          </HowStep>
          <HowStep n="2" title="Show up">
            We open the room, you join, we kick it off together.
          </HowStep>
          <HowStep n="3" title="Get auto-paired">
            Into seven-minute conversations, one after another. Everyone meets everyone, no one gets left out.
          </HowStep>
        </ol>

        <p className="text-center text-neutral-600 mt-10 mb-10 max-w-xl mx-auto">
          No networking energy. No elevator pitches. Just seven minutes at a time with one good person, then the next.
        </p>

        {/* wide rectangular reward banner · spans the full width of the 3-step
            grid above it. two-column on desktop (heading left, body right) so
            it reads horizontal, not square */}
        <div className="rounded-md p-6 md:p-8 bg-black text-white grid md:grid-cols-[1fr,1.5fr] gap-6 md:gap-10 items-center">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold mb-3" style={{ color: '#01ecf3' }}>
              And then it keeps going
            </div>
            <div className="display text-3xl md:text-4xl leading-tight">
              Easy to stay
              <br />
              in touch.
            </div>
          </div>
          <div>
            <p className="text-base md:text-lg text-neutral-300 mb-4">
              Tap to capture the people you want to stay in touch with. After the session, your follow-up list lands in your inbox. Names, LinkedIn URLs, emails. The conversation keeps going long after the call ends.
            </p>
            <p className="script text-2xl md:text-3xl" style={{ color: '#01ecf3' }}>
              what starts here, ripples →
            </p>
          </div>
        </div>
      </section>

      {/* notify form */}
      <section className="px-6 md:px-12 py-12 md:py-16 max-w-2xl mx-auto">
        <NotifyForm />
      </section>

      {/* footer */}
      <footer className="px-6 md:px-12 py-10 border-t border-neutral-200 mt-8">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
          <div className="max-w-xl">
            <div className="display text-lg mb-1">
              We Are For Good <span style={{ color: '#01ecf3' }}>*</span>
            </div>
            <p className="text-sm text-neutral-600">
              We Are For Good is a community for nonprofit and social impact changemakers who want to do work that matters.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-neutral-500">
            <Link href="/host/login" className="hover:text-black underline">
              host login →
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

// ============================================================================
// "Next session" card · pulled from /api/landing when the host has published one
// ============================================================================
function NextSessionCard({ session }) {
  const isLive = session.status === 'running_round' || session.status === 'between_rounds' || session.status === 'closing' || session.status === 'live';
  const startsAt = session.startsAt ? new Date(session.startsAt) : null;
  const startsLabel = startsAt && !Number.isNaN(startsAt.getTime())
    ? startsAt.toLocaleString(undefined, {
        weekday: 'long',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      })
    : null;

  return (
    <div className="sticker rounded-md p-6 md:p-8" style={{ background: '#01ecf3', color: '#000' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] uppercase tracking-widest font-bold opacity-70">
          {isLive ? 'Happening right now' : 'Next session'}
        </span>
        {isLive && <span className="w-2 h-2 rounded-full bg-black animate-pulse" />}
      </div>
      <div className="display text-3xl md:text-5xl mb-3">{session.name}</div>
      {startsLabel && (
        <div className="text-base md:text-lg font-semibold mb-5">{startsLabel}</div>
      )}
      {!startsLabel && !isLive && (
        <div className="text-base md:text-lg font-semibold mb-5 opacity-70">Date coming soon · drop your email below to be the first to know</div>
      )}
      <Link
        href={`/r/${session.code}`}
        className="inline-block bg-black text-white px-6 py-3 rounded-md font-bold no-underline hover:bg-neutral-800"
      >
        {isLive ? 'Join now →' : 'Save your spot *'}
      </Link>
    </div>
  );
}

// ============================================================================
// "How it works" step card
// ============================================================================
function HowStep({ n, title, children }) {
  return (
    <li className="bg-white rounded-md p-5 border border-neutral-200 sticker-sm">
      <div className="flex items-baseline gap-3 mb-2">
        <span className="display text-2xl" style={{ color: '#01ecf3' }}>{n}</span>
        <span className="display text-xl">{title}</span>
      </div>
      <p className="text-neutral-700 text-sm">{children}</p>
    </li>
  );
}

// ============================================================================
// Notify-list signup form · POST /api/notify → Kit with "good-chats-lead" tag
// ============================================================================
function NotifyForm() {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [source, setSource] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || !firstName.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          firstName: firstName.trim(),
          linkedinUrl: linkedinUrl.trim() || null,
          source: source.trim() || null,
        }),
      });
      if (!res.ok) {
        const t = await res.text();
        setError(t || "Couldn't sign you up · try again in a moment.");
        setSubmitting(false);
        return;
      }
      setDone(true);
    } catch {
      setError("Connection issue · try again in a moment.");
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="sticker bg-white rounded-md p-6 md:p-8 text-center">
        <div className="display text-3xl md:text-4xl mb-3">You're on the list <span style={{ color: '#01ecf3' }}>*</span></div>
        <p className="text-neutral-700">We'll be in touch the moment the next session is on the calendar.</p>
      </div>
    );
  }

  return (
    <div className="sticker bg-white rounded-md p-6 md:p-8">
      <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-2">
        Tell me when the next one's happening
      </div>
      <div className="display text-2xl md:text-3xl mb-2">Count me in <span style={{ color: '#01ecf3' }}>*</span></div>
      <p className="text-sm text-neutral-600 mb-5">We don't email much. Just when it matters.</p>

      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <div className="text-sm font-semibold mb-1">Email</div>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@yourwork.com"
            autoComplete="email"
            className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
          />
        </label>

        <label className="block">
          <div className="text-sm font-semibold mb-1">First name</div>
          <input
            type="text"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
            maxLength={48}
            autoComplete="given-name"
            className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
          />
        </label>

        <label className="block">
          <div className="text-sm font-semibold mb-1">
            LinkedIn <span className="text-neutral-500 font-normal">(optional)</span>
          </div>
          <input
            type="text"
            value={linkedinUrl}
            onChange={(e) => setLinkedinUrl(e.target.value)}
            placeholder="linkedin.com/in/your-profile"
            maxLength={200}
            className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
          />
        </label>

        <label className="block">
          <div className="text-sm font-semibold mb-1">
            What brought you here? <span className="text-neutral-500 font-normal">(optional)</span>
          </div>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="a friend, the podcast, a session you heard about..."
            maxLength={500}
            rows={2}
            className="w-full border-2 border-black rounded px-4 py-3 text-base resize-none focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={submitting || !email.trim() || !firstName.trim()}
          className="w-full btn-cyan py-4 text-xl rounded-md disabled:opacity-50"
        >
          {submitting ? 'Sending...' : 'Count me in *'}
        </button>

        <p className="text-xs text-neutral-500 text-center">
          We send to your inbox via Kit. Unsubscribe anytime.
        </p>
      </form>
    </div>
  );
}
