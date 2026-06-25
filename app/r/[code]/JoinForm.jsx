'use client';
import { useState, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function JoinForm({ session, knownProfile }) {
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
        setName(data.profile.display_name || '');
        setLinkedinUrl(data.profile.linkedin_url || '');
        setNewsletterOptIn(Boolean(data.profile.newsletter_opt_in));
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
        }),
      });
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

  // ─── COMPACT WELCOME-BACK VIEW ───
  if (knownProfile && !showFull) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
        <div className="w-full max-w-md">

          <div className="mb-6">
            <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-1">Good Chats · happening now</div>
            <div className="display text-4xl">{session.name}</div>
          </div>

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
          <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-1">Good Chats · happening now</div>
          <div className="display text-4xl">{session.name}</div>
        </div>

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
