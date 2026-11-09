'use client';
import { useEffect, useState } from 'react';
import { engagementView } from '@/lib/engagement-view';

// host dashboard card: what happens AFTER a call. follow-ups sent, how many people clicked a
// LinkedIn link to reach someone they met, and how far personal invites get. it stays hidden until
// there is real data (see lib/engagement-view.js), so an empty table never takes up space.
export default function EngagementCard() {
  const [d, setD] = useState(undefined);
  useEffect(() => {
    fetch('/api/host/engagement', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, []);
  if (d === undefined || d === null) return null;
  const v = engagementView(d);
  if (!v.show) return null;
  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '');
  return (
    <div className="sticker-sm bg-white rounded-md p-4 mb-3">
      <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">After the call</div>
      {v.sessions.length > 0 && (
        <div className="overflow-x-auto mt-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-widest text-neutral-500">
                <th className="py-1 pr-3">Session</th><th className="py-1 pr-3">People</th>
                <th className="py-1 pr-3">Follow-ups sent</th><th className="py-1">Clicked a LinkedIn link</th>
              </tr>
            </thead>
            <tbody>
              {v.sessions.map((s) => (
                <tr key={s.id} className="border-t border-neutral-100">
                  <td className="py-1.5 pr-3">{s.name} <span className="text-neutral-400">{fmt(s.date)}</span></td>
                  <td className="py-1.5 pr-3">{s.people}</td>
                  <td className="py-1.5 pr-3">{s.followUps}</td>
                  <td className="py-1.5">{s.linkedinClickers}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-neutral-500 mt-2">[Click counts are "at most this many people": a few email scanners open links on their own]</p>
        </div>
      )}
      {v.showInvites && (
        <div className={`text-sm ${v.sessions.length > 0 ? 'mt-3 pt-3 border-t border-neutral-100' : 'mt-2'}`}>
          <span className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mr-2">Invites</span>
          <span><strong>{v.invites.opened}</strong> opened · <strong>{v.invites.interested}</strong> signed up · <strong style={{ color: '#00838f' }}>{v.invites.joined}</strong> joined a first call</span>
        </div>
      )}
    </div>
  );
}
