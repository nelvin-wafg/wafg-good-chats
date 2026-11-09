'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

// optional passwordless sign-in. nothing in Good Chats requires it · guests join and chat exactly
// as before. signing in just unlocks the private "people you've met" history on /profile.
//
//   /signin            ask for a one-time link by email
//   /signin?t=<token>  arrived from a link · press "continue" to finish signing in
//
// the token is spent by the button (a POST), not by opening the page, so email scanners that
// pre-open links can't use it up.
export default function SignInPage() {
  const [token, setToken] = useState(null);
  const [ready, setReady] = useState(false);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('idle'); // idle | busy | sent | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('t');
      if (t) setToken(t);
    } catch {}
    setReady(true);
  }, []);

  async function consume() {
    setStatus('busy');
    setMessage('');
    try {
      const res = await fetch('/api/auth/consume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ token }),
      });
      if (res.ok) {
        window.location.href = '/profile';
        return;
      }
      setToken(null); // this link is spent or expired: fall back to asking for a new one
      setStatus('error');
      setMessage((await res.text()) || 'this link has expired or was already used');
    } catch {
      setStatus('error');
      setMessage('connection issue · try again');
    }
  }

  async function requestLink(e) {
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
      if (res.ok) {
        setStatus('sent');
        return;
      }
      setStatus('error');
      setMessage((await res.text()) || "couldn't send a link right now");
    } catch {
      setStatus('error');
      setMessage('connection issue · try again');
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md bg-white rounded-md border-2 border-black p-8 text-center" style={{ boxShadow: '4px 4px 0 #000' }}>
        <div className="display text-3xl mb-1">good<span style={{ color: '#01ecf3' }}>*</span>chats</div>

        {!ready ? (
          <p className="text-neutral-500 text-sm mt-6">[one sec...]</p>
        ) : token ? (
          <>
            <p className="text-neutral-700 mt-4 mb-6">you're almost in. tap continue to see your Good Chats history.</p>
            <button
              type="button"
              onClick={consume}
              disabled={status === 'busy'}
              className="w-full bg-black text-white font-bold rounded-md py-3 disabled:opacity-50"
            >
              {status === 'busy' ? 'signing you in...' : 'continue →'}
            </button>
            {status === 'error' && <p className="text-sm text-red-600 mt-3">{message}</p>}
          </>
        ) : status === 'sent' ? (
          <>
            <p className="display text-2xl mt-4 mb-2">check your inbox <span style={{ color: '#01ecf3' }}>*</span></p>
            <p className="text-neutral-700 text-sm">
              if there's a Good Chats profile for that email, a sign-in link is on its way. it works once and expires in 15 minutes.
            </p>
          </>
        ) : (
          <>
            <p className="text-neutral-700 mt-4 mb-1">sign in to see your next call, your history and the people you've met.</p>
            <p className="text-neutral-500 text-xs mb-5">no password · we email you a one-time link. you never need an account to join a session.</p>
            {message && <p className="text-sm text-red-600 mb-3">{message}</p>}
            <form onSubmit={requestLink} className="space-y-3 text-left">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="the email you joined with"
                className="w-full border-2 border-black rounded px-3 py-2 text-sm focus:outline-none focus:ring-2"
              />
              <button
                type="submit"
                disabled={status === 'busy' || !email.trim()}
                className="w-full bg-black text-white font-bold rounded-md py-3 disabled:opacity-50"
              >
                {status === 'busy' ? 'sending...' : 'email me a link →'}
              </button>
            </form>
          </>
        )}

        <Link href="/" className="text-xs underline text-neutral-500 mt-6 inline-block">back home</Link>
      </div>
    </main>
  );
}
