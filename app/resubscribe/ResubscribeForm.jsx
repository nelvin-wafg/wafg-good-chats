'use client';
import { useState } from 'react';

export default function ResubscribeForm({ token, maskedEmail }) {
  const [status, setStatus] = useState('idle'); // idle | saving | done
  const [error, setError] = useState(null);

  async function confirm() {
    if (status === 'saving') return;
    setStatus('saving');
    setError(null);
    try {
      const res = await fetch(`/api/resubscribe?t=${encodeURIComponent(token)}`, { method: 'POST' });
      if (!res.ok) {
        setError((await res.text()) || "Couldn't add you back · try again");
        setStatus('idle');
        return;
      }
      setStatus('done');
    } catch {
      setError("Couldn't add you back · check your connection and try again");
      setStatus('idle');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md text-center">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-2">good chats</div>
        {status === 'done' ? (
          <>
            <div className="display text-5xl mb-4">You're back<br />on the list.</div>
            <p className="text-neutral-700 mb-2">We'll email <strong>{maskedEmail}</strong> once, when the next call is scheduled.</p>
            <p className="text-sm text-neutral-500 mb-6">[You can unsubscribe again from any email we send.]</p>
            <a href="/" className="text-sm underline">Back home</a>
          </>
        ) : (
          <>
            <div className="display text-5xl mb-4">Rejoin the list?</div>
            <p className="text-neutral-700 mb-6">You unsubscribed earlier. Add <strong>{maskedEmail}</strong> back for one email when the next call is scheduled?</p>
            <button type="button" onClick={confirm} disabled={status === 'saving'} className="w-full btn-cyan py-4 text-xl rounded-md disabled:opacity-50">
              {status === 'saving' ? 'One sec...' : 'Yes, add me back'}
            </button>
            {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            <a href="/" className="inline-block mt-4 text-sm underline text-neutral-600">No, take me home</a>
          </>
        )}
      </div>
    </main>
  );
}
