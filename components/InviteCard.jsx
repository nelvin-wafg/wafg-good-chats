'use client';
import { useEffect, useMemo, useState } from 'react';
import { showToast } from '@/components/Toast';

// the profile's invite card: a personal link, a post to go with it, and the referral tracker.
// sharing a QUESTION from the last call (instead of a badge) is the point: a question makes a
// stranger curious, and the invite comes from someone they trust.
export default function InviteCard({ moments = [] }) {
  const [inv, setInv] = useState(undefined); // undefined = loading, null = unavailable
  const [off, setOff] = useState(false);     // invites not switched on yet (SQL not run)
  const [momentId, setMomentId] = useState('');
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

  const moment = useMemo(() => moments.find((m) => m.roundId === momentId) || null, [moments, momentId]);
  const link = inv ? `${inv.url}${moment ? `?m=${moment.roundId}` : ''}` : '';

  // the suggested post. it re-writes itself when the question changes, until the person edits it
  useEffect(() => {
    if (!inv || edited) return;
    setCaption(
      moment
        ? `A question from my last Good Chats: "${moment.prompt}" I answered it live, one-on-one, with someone I'd never met. Come answer it with me: ${link}`
        : `Six conversations in 45 minutes with people doing good, on Good Chats. Join me for the next one: ${link}`
    );
  }, [inv, moment, link, edited]);

  const textToShare = () => (caption.includes(link) ? caption : `${caption.trim()} ${link}`.trim());

  async function copy(text, okMsg) {
    try { await navigator.clipboard.writeText(text); showToast(okMsg, 'success'); }
    catch { showToast("couldn't copy · select and copy it by hand", 'error'); }
  }
  async function shareLinkedIn() {
    // LinkedIn only takes the link from the share URL (it ignores any text), so copy the post first
    try { await navigator.clipboard.writeText(textToShare()); showToast('post text copied · paste it into your LinkedIn post', 'success'); } catch {}
    window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`, '_blank', 'noopener,noreferrer');
  }
  async function nativeShare() {
    try { await navigator.share({ text: caption, url: link }); } catch {}
  }
  async function regenerate() {
    if (!window.confirm('make a new invite link? the old one stops working.')) return;
    try { await call('regenerate'); setEdited(false); showToast('new link ready', 'success'); } catch { showToast("couldn't make a new link", 'error'); }
  }

  const shell = (children) => (
    <div className="bg-white rounded-md border border-neutral-200 p-5 mb-6">
      <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-2">invite someone</div>
      {children}
    </div>
  );

  if (inv === undefined) return shell(<p className="text-sm text-neutral-500">[making your link...]</p>);
  if (inv === null) {
    return shell(<p className="text-sm text-neutral-500">{off ? "personal invite links aren't switched on yet." : "couldn't load your invite link just now · try refreshing."}</p>);
  }

  const canNative = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const { stats, joined } = inv;

  return shell(
    <>
      <p className="text-sm text-neutral-700">the best way to grow Good Chats is you. share your link, and when a friend joins their first call you'll see it here.</p>

      <div className="mt-3 flex items-center gap-2">
        <input readOnly value={link} onFocus={(e) => e.target.select()}
               className="flex-1 min-w-0 border-2 border-black rounded px-3 py-2 text-xs bg-neutral-50" />
        <button type="button" onClick={() => copy(link, 'link copied')} className="bg-black text-white font-bold rounded-md px-3 py-2 text-xs flex-shrink-0">copy link</button>
      </div>

      {moments.length > 0 && (
        <div className="mt-4">
          <div className="text-xs font-bold text-neutral-600 mb-1.5">add a question from your last call (makes people curious)</div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs flex items-start gap-2 cursor-pointer">
              <input type="radio" name="moment" checked={momentId === ''} onChange={() => { setMomentId(''); setEdited(false); }} className="mt-0.5" />
              <span className="text-neutral-700">no question, just the invite</span>
            </label>
            {moments.map((m) => (
              <label key={m.roundId} className="text-xs flex items-start gap-2 cursor-pointer">
                <input type="radio" name="moment" checked={momentId === m.roundId} onChange={() => { setMomentId(m.roundId); setEdited(false); }} className="mt-0.5" />
                <span className="text-neutral-800">"{m.prompt}"</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="text-xs font-bold text-neutral-600 mb-1.5">your post (edit it however you like)</div>
        <textarea value={caption} onChange={(e) => { setCaption(e.target.value); setEdited(true); }} rows={4}
                  className="w-full border-2 border-black rounded px-3 py-2 text-sm" />
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" onClick={shareLinkedIn} className="text-white font-bold rounded-md px-3 py-2 text-xs" style={{ background: '#0a66c2' }}>share on LinkedIn →</button>
          <button type="button" onClick={() => copy(textToShare(), 'post text copied')} className="border-2 border-black rounded-md px-3 py-2 text-xs font-bold">copy post text</button>
          {canNative && <button type="button" onClick={nativeShare} className="border-2 border-black rounded-md px-3 py-2 text-xs font-bold">share...</button>}
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-neutral-200">
        <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-2">who your invite reached</div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <Stat n={stats.visits} label="opened it" />
          <Stat n={stats.interested} label="signed up" />
          <Stat n={stats.joined} label="joined a call" highlight />
        </div>
        {joined.length > 0 ? (
          <p className="text-sm mt-3 text-neutral-800">you brought <span className="font-bold">{joined.map((j) => j.firstName).join(', ')}</span>. thank you.</p>
        ) : (
          <p className="text-xs mt-3 text-neutral-500">no one yet. when someone you invite joins their first call, they show up here.</p>
        )}
        <button type="button" onClick={regenerate} className="text-[11px] underline text-neutral-500 hover:text-black mt-3">make a new link</button>
      </div>
    </>
  );
}

function Stat({ n, label, highlight }) {
  return (
    <div className="rounded-md py-2" style={highlight ? { background: '#01ecf3' } : { background: '#f4f4f1' }}>
      <div className="display text-xl">{n}</div>
      <div className="text-[10px] uppercase tracking-widest font-bold opacity-70">{label}</div>
    </div>
  );
}
