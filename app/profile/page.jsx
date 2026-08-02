'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { colorForName, initials } from '@/lib/brand';
import { showToast } from '@/components/Toast';

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
      showToast('connection issue · try again', 'error');
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
        showToast((await res.text()) || "couldn't save", 'error');
        return;
      }
      setData((d) => ({ ...d, profile: { ...d.profile, displayName: name.trim(), linkedinUrl: linkedinUrl.trim() || null } }));
      setEditing(false);
      showToast('saved', 'success');
    } catch {
      showToast('connection issue · try again', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleAvatarPick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showToast('image must be 5MB or smaller', 'error');
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
        showToast((await res.text()) || 'upload failed', 'error');
        return;
      }
      const { avatarUrl } = await res.json();
      setData((d) => ({ ...d, profile: { ...d.profile, avatarUrl } }));
      showToast('photo updated', 'success');
    } catch {
      showToast('connection issue · try again', 'error');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-8" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[loading your profile...]</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 text-center" style={{ background: '#f4f4f1' }}>
        <div className="max-w-md">
          <div className="display text-4xl mb-3">we don't know you yet <span style={{ color: '#01ecf3' }}>*</span></div>
          <p className="text-neutral-600">join a Good Chats session first · your profile shows up here once you have.</p>
          <Link href="/" className="text-sm underline mt-6 inline-block">back home →</Link>
        </div>
      </main>
    );
  }

  const { profile, stats, history } = data;

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-3xl mx-auto" style={{ background: '#f4f4f1' }}>
      <div className="mb-6">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500">Good Chats · your profile</div>
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
              title="update your photo"
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
              title="update your photo"
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
                  member since {new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                  {profile.linkedinUrl && (
                    <> · <a href={profile.linkedinUrl} target="_blank" rel="noopener noreferrer" className="underline">{profile.linkedinUrl.replace(/^https?:\/\//, '')}</a></>
                  )}
                </div>
                <button type="button" onClick={() => setEditing(true)} className="text-xs underline text-neutral-500 hover:text-black mt-2">
                  edit name / linkedin
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
                  placeholder="your name"
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
                    {saving ? 'saving...' : 'save *'}
                  </button>
                  <button type="button" onClick={() => { setEditing(false); setName(profile.displayName || ''); setLinkedinUrl(profile.linkedinUrl || ''); }} className="text-sm underline text-neutral-500 hover:text-black">
                    cancel
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>

      {/* stats · private to this profile only */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatTile label="good chats" value={stats.goodChats} highlight />
        <StatTile label="connections made" value={stats.connectionsMade} />
        <StatTile label="events attended" value={stats.eventsAttended} />
      </div>

      {/* history */}
      <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-neutral-200">
          <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">your history · private, only you see this</div>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-neutral-500 italic px-5 py-4">[no sessions yet]</p>
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
                    <span className="font-semibold">captured {h.capturedCount} {h.capturedCount === 1 ? 'person' : 'people'}</span>
                  ) : (
                    <span className="text-neutral-400">no captures</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-neutral-500 mt-6 text-center">
        [only you can see this page · nothing here is shown to other participants except your name, photo, and linkedin during a live session]
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
