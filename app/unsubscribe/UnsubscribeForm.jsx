'use client';
import { useState } from 'react';

export default function UnsubscribeForm({ token, maskedEmail }) {
  const [status, setStatus] = useState('idle'); // idle | saving | done
  const [error, setError] = useState(null);

  async function unsubscribe() {
    if (status === 'saving') return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch(`/api/unsubscribe?t=${encodeURIComponent(token)}`, { method: 'POST' });
      if (!res.ok) {
        setError((await res.text()) || "couldn't unsubscribe you · try again");
        setStatus('idle');
        return;
      }
      setStatus('done');
    } catch {
      setError("couldn't unsubscribe you · check your connection and try again");
      setStatus('idle');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md text-center">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-2">Good Chats</div>
        {status === 'done' ? (
          <>
            <div className="display text-5xl mb-4">you're<br />unsubscribed.</div>
            <p className="text-neutral-700 mb-2">we won't email <strong>{maskedEmail}</strong> about Good Chats sessions anymore.</p>
            <p className="text-sm text-neutral-500 mb-6">
              [changed your mind? you can sign up again any time on the homepage.]
            </p>
            <a href="/" className="text-sm underline">back home</a>
          </>
        ) : (
          <>
            <div className="display text-5xl mb-4">unsubscribe?</div>
            <p className="text-neutral-700 mb-6">
              stop Good Chats session emails to <strong>{maskedEmail}</strong>.
            </p>
            <button
              type="button"
              onClick={unsubscribe}
              disabled={status === 'saving'}
              className="w-full btn-cyan py-4 text-xl rounded-md disabled:opacity-50"
            >
              {status === 'saving' ? 'one sec...' : 'yes, unsubscribe me'}
            </button>
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            <p className="text-xs text-neutral-500 mt-6">
              [if you also get "The Weekly" newsletter, that has its own unsubscribe link at the bottom of each issue.]
            </p>
            <a href="/" className="inline-block mt-4 text-sm underline text-neutral-600">no, take me home</a>
          </>
        )}
      </div>
    </main>
  );
}
