'use client';
import { useState } from 'react';

// the "email me a sign-in link" form, shared by /signin and the /profile screen for people this browser
// doesn't recognize. no password: it emails a one-time link to the address if a profile exists for it,
// and says the same thing either way so it can't be used to find out who has used good chats.
export default function EmailLinkForm({ buttonLabel = 'Email me a link →' }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | busy | sent | error
  const [message, setMessage] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!email.trim() || status === 'busy') return;
    setStatus('busy');
    setMessage('');
    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.ok) { setStatus('sent'); return; }
      setStatus('error');
      setMessage((await res.text()) || "Couldn't send a link right now");
    } catch {
      setStatus('error');
      setMessage('Connection issue · try again');
    }
  }

  if (status === 'sent') {
    return (
      <div className="text-center">
        <p className="display text-2xl mt-2 mb-2">Check your inbox <span style={{ color: '#01ecf3' }}>*</span></p>
        <p className="text-neutral-700 text-sm">
          If there's a good chats profile for that email, a sign-in link is on its way. It works once and expires in 15 minutes.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      {message && <p className="text-sm text-red-600">{message}</p>}
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        placeholder="The email you joined with"
        className="w-full border-2 border-black rounded px-3 py-2 text-sm focus:outline-none focus:ring-2"
      />
      <button
        type="submit"
        disabled={status === 'busy' || !email.trim()}
        className="w-full bg-black text-white font-bold rounded-md py-3 disabled:opacity-50"
      >
        {status === 'busy' ? 'Sending...' : buttonLabel}
      </button>
    </form>
  );
}
