'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function JoinForm({ session }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleJoin(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${session.id}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) throw new Error(await res.text());
      // identity is now in an HttpOnly cookie set by the server.
      // we keep the display name in sessionStorage for UI use only.
      try {
        window.sessionStorage.setItem(`pname:${session.id}`, name.trim());
      } catch {}
      router.push(`/r/${session.code}/room`);
    } catch (err) {
      setError("couldn't join · try again in a sec.");
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md">

        {/* event header */}
        <div className="mb-6">
          <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-1">good chats · happening now</div>
          <div className="display text-4xl">
            {session.name}
          </div>
        </div>

        {/* form card */}
        <form onSubmit={handleJoin} className="sticker bg-white rounded-md p-6 mb-6">
          <label className="block text-sm font-semibold mb-2">what should we call you?</label>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="your name"
            className="w-full border-2 border-black rounded px-4 py-3 text-lg mb-4 focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
            maxLength={48}
            required
          />
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="w-full btn-cyan py-4 text-xl rounded-md disabled:opacity-50"
          >
            {submitting ? 'warming things up...' : 'i\'m in *'}
          </button>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </form>

        {/* expectations card */}
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
