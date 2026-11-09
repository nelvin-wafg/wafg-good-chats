'use client';
import { useEffect, useState } from 'react';

// host dashboard card: what happens AFTER a call. recaps and follow-ups sent, how many people
// clicked a LinkedIn link to reach someone they met, and how far personal invites get.
export default function EngagementCard() {
  const [d, setD] = useState(undefined);
  useEffect(() => {
    fetch('/api/host/engagement', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, []);
  if (d === undefined || d === null) return null;
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  const setup = d.setupNeeded || {};
  return (
    <div className="sticker-sm bg-white rounded-md p-4 mb-3">
      <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">after the call</div>
      {d.sessions.length === 0 ? (
        <p className="text-sm text-neutral-500 mt-2">no finished sessions yet.</p>
      ) : (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-neutral-500">
                <th className="py-1 pr-3">session</th><th className="py-1 pr-3">people</th><th className="py-1 pr-3">recaps</th>
                <th className="py-1 pr-3">follow-ups</th><th className="py-1">clicked a LinkedIn link</th>
              </tr>
            </thead>
            <tbody>
              {d.sessions.map((s) => (
                <tr key={s.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3">{s.name} <span className="text-neutral-400">{fmt(s.date)}</span></td>
                  <td className="py-1.5 pr-3">{s.people}</td>
                  <td className="py-1.5 pr-3">{s.recaps}</td>
                  <td className="py-1.5 pr-3">{setup.followups ? '·' : s.followUps}</td>
                  <td className="py-1.5">{setup.clicks ? '·' : s.linkedinClickers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-neutral-100 text-sm">
        <span className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mr-2">invites</span>
        {setup.invites ? <span className="text-neutral-500">not switched on yet</span> : (
          <span><strong>{d.invites.opened}</strong> opened · <strong>{d.invites.interested}</strong> signed up · <strong style={{ color: '#00838f' }}>{d.invites.joined}</strong> joined a first call</span>
        )}
      </div>
      {(setup.clicks || setup.followups) && (
        <p className="text-[11px] text-neutral-500 mt-2">· = the follow-up / click tracking SQL hasn't been run yet. click counts are "at most this many people": a few email scanners open links on their own.</p>
      )}
    </div>
  );
}
