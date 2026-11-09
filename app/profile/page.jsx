'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { colorForName, initials } from '@/lib/brand';
import { showToast } from '@/components/Toast';
import NextCallCard from '@/components/NextCallCard';
import InviteCard from '@/components/InviteCard';

// standalone "my profile" page · authenticated by the 6-month profile cookie
// (same one that powers "welcome back" on the join form). private to the
// owner only — no public leaderboard, per design. lets a returning
// participant see why they keep coming back: their photo, their history,
// their stats.
export default function ProfilePage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const [linkStatus, setLinkStatus] = useState('idle'); // idle | busy | sent

  useEffect(() => {
    load();
  }, []);

  async function load() {
    try {
      const res = await fetch('/api/profiles/me', { credentials: 'same-origin' });
      if (!res.ok) { setLoading(false); return; }
      const d = await res.json();
      setData(d);
      setName(d.profile.displayName || '');
      setLinkedinUrl(d.profile.linkedinUrl || '');
    } catch {
      showToast('Connection issue · try again', 'error');
    } finally {
      setLoading(false);
    }
  }

  async function saveEdits(e) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name: name.trim(), linkedinUrl: linkedinUrl.trim() || null }),
      });
      if (!res.ok) {
        showToast((await res.text()) || "Couldn't save", 'error');
        return;
      }
      setData((d) => ({ ...d, profile: { ...d.profile, displayName: name.trim(), linkedinUrl: linkedinUrl.trim() || null } }));
      setEditing(false);
      showToast('Saved', 'success');
    } catch {
      showToast('Connection issue · try again', 'error');
    } finally {
      setSaving(false);
    }
  }

  // optional passwordless sign-in: emails a one-time link to the profile's own address.
  // signing in unlocks the private "people you've met" list.
  async function sendSignInLink() {
    if (!data?.profile?.email || linkStatus === 'busy') return;
    setLinkStatus('busy');
    try {
      const res = await fetch('/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: data.profile.email }),
      });
      if (!res.ok) {
        showToast((await res.text()) || "Couldn't send a link right now", 'error');
        setLinkStatus('idle');
        return;
      }
      setLinkStatus('sent');
    } catch {
      showToast('Connection issue · try again', 'error');
      setLinkStatus('idle');
    }
  }

  async function signOut() {
    try { await fetch('/api/profiles/signout', { method: 'POST', credentials: 'same-origin' }); } catch {}
    window.location.href = '/';
  }

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('Image must be 5MB or smaller', 'error');
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/profiles/avatar', {
        method: 'POST',
        credentials: 'same-origin',
        body: form,
      });
      if (!res.ok) {
        showToast((await res.text()) || 'Upload failed', 'error');
        return;
      }
      const { avatarUrl } = await res.json();
      setData((d) => ({ ...d, profile: { ...d.profile, avatarUrl } }));
      showToast('Photo updated', 'success');
    } catch {
      showToast('Connection issue · try again', 'error');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-8" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[Loading your profile...]</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-center" style={{ background: '#f4f4f1' }}>
        <div className="max-w-md">
          <div className="display text-4xl mb-3">We don't know you yet <span style={{ color: '#01ecf3' }}>*</span></div>
          <p className="text-neutral-600">Join a good chats session first · your profile shows up here once you have.</p>
          <Link href="/" className="text-sm underline mt-6 inline-block">Back home →</Link>
        </div>
      </main>
    );
  }

  const { profile, stats, history, signedIn, people } = data;

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-3xl mx-auto" style={{ background: '#f4f4f1' }}>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500">good chats · your profile</div>
      </div>

      {/* header · avatar + name + edit */}
      <div className="bg-white rounded-md p-6 border border-neutral-200 mb-6 sticker-sm">
        <div className="flex items-start gap-5 flex-wrap">
          <div className="relative flex-shrink-0">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="block w-16 h-16 rounded-full overflow-hidden border-2 border-black"
              title="Update your photo"
              style={!profile.avatarUrl ? { background: colorForName(profile.displayName || '') } : undefined}
            >
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center display text-xl text-black">
                  {initials(profile.displayName || '?')}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs border-2 border-white"
              style={{ background: '#01ecf3' }}
              title="Update your photo"
            >
              {uploading ? '…' : '✎'}
            </button>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={handleAvatarPick} />
          </div>

          <div className="flex-1 min-w-0">
            {!editing ? (
              <>
                <div className="display text-2xl">{profile.displayName} <span style={{ color: '#01ecf3' }}>*</span></div>
                <div className="text-sm text-neutral-500 mt-0.5">
                  Member since {new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                  {profile.linkedinUrl && (
                    <> · <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="underline">{profile.linkedinUrl.replace(/^https?:\/\//, '')}</a></>
                  )}
                </div>
                <button type="button" onClick={() => setEditing(true)} className="text-xs underline text-neutral-500 hover:text-black mt-2">
                  Edit name / LinkedIn
                </button>
              </>
            ) : (
              <form onSubmit={saveEdits} className="space-y-2 max-w-sm">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={48}
                  required
                  className="w-full border-2 border-black rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
                  placeholder="Your name"
                />
                <input
                  value={linkedinUrl}
                  onChange={(e) => setLinkedinUrl(e.target.value)}
                  maxLength={200}
                  className="w-full border-2 border-black rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
                  placeholder="linkedin.com/in/your-profile"
                />
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={saving || !name.trim()} className="btn-cyan px-4 py-2 rounded text-sm disabled:opacity-50">
                    {saving ? 'Saving...' : 'Save *'}
                  </button>
                  <button type="button" onClick={() => { setEditing(false); setName(profile.displayName || ''); setLinkedinUrl(profile.linkedinUrl || ''); }} className="text-sm underline text-neutral-500 hover:text-black">
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* the one-stop part: what's next, and bringing someone along */}
      <NextCallCard profile={profile} />
      <InviteCard />

      {/* stats · private to this profile only */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatTile label="good chats" value={stats.goodChats} highlight />
        <StatTile label="People met" value={stats.peopleMet ?? 0} />
        <StatTile label="Events attended" value={stats.eventsAttended} />
      </div>

      {/* people you've met · private. needs the optional email sign-in, because the plain profile
          cookie can be handed out by the join form to anyone who types an email. */}
      <div className="bg-white rounded-md border border-neutral-200 overflow-hidden mb-6">
        <div className="px-5 py-3 border-b border-neutral-200">
          <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">People you've met · private, only you see this</div>
        </div>
        {signedIn ? (
          !people || people.length === 0 ? (
            <p className="text-sm text-neutral-500 italic px-5 py-4">[Nobody yet · your pairings show up here after a session]</p>
          ) : (
            <div className="divide-y divide-neutral-200">
              {people.map((sess) => (
                <div key={sess.sessionId} className="px-5 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="font-semibold truncate">{sess.sessionName}</div>
                    <div className="text-xs text-neutral-500 flex-shrink-0">{new Date(sess.date).toLocaleDateString()}</div>
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {sess.partners.map((pt, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 text-sm">
                        <span className="min-w-0">
                          <span className="font-medium">{pt.name}</span>
                          {pt.starred && <span style={{ color: '#01ecf3' }} className="font-bold"> ✦</span>}
                          <span className="text-xs text-neutral-500">
                            {' '}· {[pt.round ? `round ${pt.round}` : null, pt.roomLabel].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        {pt.linkedinUrl && (
                          <a href={pt.linkedinUrl} target="_blank" rel="noopener noreferrer"
                             className="flex-shrink-0 text-xs font-bold text-white rounded px-3 py-1" style={{ background: '#0a66c2' }}>
                            LinkedIn →
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )
        ) : (
          <div className="px-5 py-5 text-center">
            <p className="text-sm text-neutral-700">Sign in to see everyone you've been paired with, across every session.</p>
            <p className="text-xs text-neutral-500 mt-1 mb-4">Optional · no password. We email a one-time link to {profile.email}.</p>
            {linkStatus === 'sent' ? (
              <p className="text-sm font-semibold" style={{ color: '#00838f' }}>Check your inbox · the link works once and expires in 15 minutes.</p>
            ) : (
              <button type="button" onClick={sendSignInLink} disabled={linkStatus === 'busy'}
                      className="bg-black text-white font-bold rounded-md px-5 py-2 text-sm disabled:opacity-50">
                {linkStatus === 'busy' ? 'Sending...' : 'Email me a sign-in link →'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* history */}
      <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200">
          <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">Your history · private, only you see this</div>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500 italic px-5 py-4">[No sessions yet]</p>
        ) : (
          <ul className="divide-y divide-neutral-200">
            {history.map((h) => (
              <li key={h.sessionId} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{h.sessionName}</div>
                  <div className="text-xs text-neutral-500">{new Date(h.date).toLocaleDateString()}</div>
                </div>
                <div className="text-sm flex-shrink-0" style={{ color: h.capturedCount > 0 ? '#00838f' : undefined }}>
                  {h.capturedCount > 0 ? (
                    <span className="font-semibold">Captured {h.capturedCount} {h.capturedCount === 1 ? 'person' : 'people'}</span>
                  ) : (
                    <span className="text-neutral-400">No captures</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="text-center mt-6">
        <button type="button" onClick={signOut} className="text-xs underline text-neutral-500 hover:text-black">
          Sign out of this browser
        </button>
      </div>

      <p className="text-xs text-neutral-500 mt-4 text-center">
        [Only you can see this page · nothing here is shown to other participants except your name, photo, and LinkedIn during a live session]
      </p>
    </main>
  );
}

function StatTile({ label, value, highlight }) {
  return (
    <div
      className={`rounded-md p-4 text-center ${highlight ? 'sticker' : 'bg-white border border-neutral-200'}`}
      style={highlight ? { background: '#01ecf3' } : undefined}
    >
      <div className="display text-2xl md:text-3xl">{value}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold mt-1 opacity-70">{label}</div>
    </div>
  );
}
