'use client';
import { useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-browser';

function LoginInner() {
  const params = useSearchParams();
  const isPending = params.get('pending') === '1';
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/api/auth/callback?next=/host`,
      },
    });
    if (error) {
      setError(error.message);
      setSubmitting(false);
    } else {
      setSent(true);
    }
  }

  if (isPending) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
        <div className="w-full max-w-md text-center">
          <div className="display text-5xl mb-3">you're not<br/>on the list yet.</div>
          <p className="text-neutral-600 mb-8">
            hosting is invite-only while we test this thing. ping nelvin to get added.
          </p>
          <a href="/" className="text-sm underline">back home</a>
        </div>
      </main>
    );
  }

  if (sent) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
        <div className="w-full max-w-md text-center">
          <div className="display text-5xl mb-3">check your<br/>inbox <span style={{ color: '#01ecf3' }}>*</span></div>
          <p className="text-neutral-600 mb-2">
            we sent a magic link to <strong>{email}</strong>.
          </p>
          <p className="text-sm text-neutral-500 mb-8">
            [click it within 10 minutes · check spam if you don't see it]
          </p>
          <button
            onClick={() => { setSent(false); setEmail(''); }}
            className="text-sm underline"
          >
            wrong email? try again
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6" style={{ background: '#f4f4f1' }}>
      <div className="w-full max-w-md">
        <div className="display text-5xl mb-2">host login</div>
        <p className="text-neutral-600 mb-8">
          [no passwords here · we email you a one-tap login link]
        </p>

        <form onSubmit={handleSubmit} className="sticker bg-white rounded-md p-6">
          <label className="block text-sm font-semibold mb-2">your email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@weareforgood.com"
            required
            autoFocus
            className="w-full border-2 border-black rounded px-4 py-3 mb-4 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
          />
          <button
            type="submit"
            disabled={submitting || !email}
            className="w-full btn-cyan py-4 text-lg rounded-md disabled:opacity-50"
          >
            {submitting ? 'sending...' : 'send the link *'}
          </button>
          {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        </form>

        <p className="text-xs text-neutral-500 mt-6">
          hosting is invite-only. if you've never logged in, you'll need to be approved by an admin first.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}
