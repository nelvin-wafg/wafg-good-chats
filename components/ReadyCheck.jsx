'use client';
import { useEffect, useState } from 'react';

// the host's pre-round "ready check". shown while the main room is open and the first round hasn't
// started. it only reads signals people already produce (the mic check in the waiting room, their
// connection, their heartbeat), so nothing new is tracked; it never blocks starting.
const TONE = {
  bad: { dot: '#dc2626', bg: '#fef2f2', border: '#fca5a5', label: 'Needs attention' },
  warn: { dot: '#d97706', bg: '#fffbeb', border: '#fcd34d', label: 'Worth a look' },
  info: { dot: '#737373', bg: '#f4f4f1', border: '#e5e5e5', label: 'Just so you know' },
};

export default function ReadyCheck({ sessionId }) {
  const [d, setD] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/sessions/${sessionId}/ready-check`, { credentials: 'same-origin', cache: 'no-store' });
        if (!res.ok || cancelled) return;
        setD(await res.json());
      } catch {}
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, [sessionId]);

  if (!d) return null;

  const headline = d.present === 0
    ? 'Waiting for people to arrive.'
    : d.flagged === 0
      ? `Everyone looks ready · ${d.present} in the room`
      : d.clear
        ? `${d.present} in the room · a few just arrived`
        : `${d.bad + d.warn} of ${d.present} may have trouble`;
  const good = d.present > 0 && d.clear;

  return (
    <div className="rounded-md border p-3" style={{ background: good ? '#f0fdf4' : '#fff', borderColor: good ? '#86efac' : '#e5e5e5' }}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">Ready check</div>
        <div className="text-sm font-semibold" style={{ color: good ? '#166534' : '#000' }}>{headline}</div>
      </div>

      {d.flagged > 0 && (
        <ul className="mt-2 space-y-1.5">
          {d.people.slice(0, 8).map((p) => {
            const t = TONE[p.worst];
            return (
              <li key={p.id} className="rounded px-2.5 py-1.5 text-sm" style={{ background: t.bg, border: `1px solid ${t.border}` }}>
                <div className="flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ background: t.dot }} />
                  <span className="font-semibold">{p.name}</span>
                  <span className="text-xs text-neutral-500">{t.label}</span>
                </div>
                <ul className="mt-0.5 ml-4 text-xs text-neutral-700">
                  {p.issues.map((i) => (
                    <li key={i.code}><span className="font-semibold">{i.text}.</span> {i.hint}</li>
                  ))}
                </ul>
              </li>
            );
          })}
          {d.people.length > 8 && <li className="text-xs text-neutral-500 ml-1">…and {d.people.length - 8} more</li>}
        </ul>
      )}
      <p className="text-[11px] text-neutral-500 mt-2">[Updates every few seconds · you can start whenever you're ready]</p>
    </div>
  );
}
