'use client';
import { useEffect, useState } from 'react';
import { showToast } from '@/components/Toast';

// the profile's invite card: a personal link, a post to go with it, and the referral tracker.
// kept deliberately simple: one link, one post you can edit, one quiet line of numbers.
export default function InviteCard() {
  const [inv, setInv] = useState(undefined); // undefined = loading, null = unavailable
  const [off, setOff] = useState(false);     // invites not switched on yet (SQL not run)
  const [caption, setCaption] = useState('');
  const [edited, setEdited] = useState(false);

  async function call(action) {
    const res = await fetch('/api/profiles/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ action }),
    });
    if (res.status === 503) { setOff(true); setInv(null); return; }
    if (!res.ok) { setInv(null); return; }
    setInv(await res.json());
  }
  useEffect(() => { call('ensure').catch(() => setInv(null)); }, []);

  const link = inv ? inv.url : '';

  // the suggested post. it rewrites itself if the link changes, until the person edits it
  useEffect(() => {
    if (!inv || edited) return;
    setCaption(`Six conversations in 45 minutes with people doing good, on good chats. Join me for the next one: ${inv.url}`);
  }, [inv, edited]);

  const textToShare = () => (caption.includes(link) ? caption : `${caption.trim()} ${link}`.trim());

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); showToast(okMsg, 'success'); }
    catch { showToast("Couldn't copy · select and copy it by hand", 'error'); }
  }
  async function shareLinkedIn() {
    // LinkedIn only takes the link from the share URL (it ignores any text), so copy the post first
    try { await navigator.clipboard.writeText(textToShare()); showToast('Post text copied · paste it into your LinkedIn post', 'success'); } catch {}
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`, '_blank', 'noopener,noreferrer');
  }
  async function nativeShare() {
    try { await navigator.share({ text: caption, url: link }); } catch {}
  }
  async function regenerate() {
    if (!window.confirm('Make a new invite link? The old one stops working.')) return;
    try { await call('regenerate'); setEdited(false); showToast('New link ready', 'success'); } catch { showToast("Couldn't make a new link", 'error'); }
  }

  const heading = (
    <div className="display text-2xl">Invite someone <span style={{ color: '#01ecf3' }}>*</span></div>
  );
  const shell = (children) => (
    <div className="bg-white rounded-md border border-neutral-200 p-6 mb-6">
      {heading}
      {children}
    </div>
  );

  if (inv === undefined) return shell(<p className="text-sm text-neutral-500 mt-2">[Making your link...]</p>);
  if (inv === null) {
    return shell(<p className="text-sm text-neutral-500 mt-2">{off ? "Personal invite links aren't switched on yet." : "Couldn't load your invite link just now · try refreshing."}</p>);
  }

  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const { stats, joined } = inv;

  return shell(
    <>
      <p className="text-sm text-neutral-600 mt-1">Share your link. When a friend joins their first call, you'll see it here.</p>

      <div className="mt-5 flex items-center gap-2">
        <input readOnly value={link} onFocus={(e) => e.target.select()}
               className="flex-1 min-w-0 border-2 border-black rounded px-3 py-2 text-sm bg-neutral-50" />
        <button type="button" onClick={() => copy(link, 'Link copied')} className="bg-black text-white font-bold rounded-md px-4 py-2 text-sm flex-shrink-0">Copy link</button>
      </div>

      <div className="mt-6">
        <div className="text-sm font-bold mb-1.5">Your post</div>
        <textarea value={caption} onChange={(e) => { setCaption(e.target.value); setEdited(true); }} rows={4}
                  className="w-full border-2 border-black rounded px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-2 mt-3">
          <button type="button" onClick={shareLinkedIn} className="text-white font-bold rounded-md px-4 py-2 text-sm" style={{ background: '#0a66c2' }}>Share on LinkedIn →</button>
          <button type="button" onClick={() => copy(textToShare(), 'Post text copied')} className="border-2 border-black rounded-md px-4 py-2 text-sm font-bold">Copy post text</button>
          {canNative && <button type="button" onClick={nativeShare} className="border-2 border-black rounded-md px-4 py-2 text-sm font-bold">Share...</button>}
        </div>
      </div>

      <div className="mt-6 pt-4 border-t border-neutral-200">
        <p className="text-sm text-neutral-700">
          <span className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mr-2">Who your invite reached</span>
          <strong>{stats.visits}</strong> opened · <strong>{stats.interested}</strong> signed up · <strong style={stats.joined > 0 ? { color: '#00838f' } : undefined}>{stats.joined}</strong> joined a call
        </p>
        {joined.length > 0 && (
          <p className="text-sm mt-2 text-neutral-800">You brought <span className="font-bold">{joined.map((j) => j.firstName).join(', ')}</span>. Thank you.</p>
        )}
        <button type="button" onClick={regenerate} className="text-[11px] underline text-neutral-400 hover:text-black mt-3">Make a new link</button>
      </div>
    </>
  );
}
