'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import CopyLink from '@/components/CopyLink';
import Sparkline from '@/components/Sparkline';
import { showToast } from '@/components/Toast';

export default function HostDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/host/dashboard', { credentials: 'same-origin' });
        if (!res.ok) {
          showToast("couldn't load dashboard", 'error');
          return;
        }
        const d = await res.json();
        if (!cancelled) setData(d);
      } catch (e) {
        showToast(e.message || 'connection issue', 'error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  async function handleDelete(sessionId, name) {
    if (!confirm(`delete "${name}" permanently? this removes all participants, pairings, and captures from the database. cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      if (!res.ok) {
        showToast(await res.text() || "couldn't delete", 'error');
        return;
      }
      showToast('session deleted', 'success');
      // refetch
      const fresh = await fetch('/api/host/dashboard', { credentials: 'same-origin' });
      if (fresh.ok) setData(await fresh.json());
    } catch (e) {
      showToast(e.message || 'delete failed', 'error');
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen p-8" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[loading dashboard...]</p>
      </main>
    );
  }

  if (!data) {
    return (
      <main className="min-h-screen p-8" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[couldn't load dashboard · refresh to try again]</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-6xl mx-auto" style={{ background: '#f4f4f1' }}>

      <header className="flex items-start justify-between mb-8 gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest font-bold text-neutral-500">spread good chats · host</div>
          <div className="display text-3xl md:text-4xl mt-1">
            hey {data.host?.display_name || 'friend'} <span style={{ color: '#01ecf3' }}>*</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-sm">
          <Link href="/host/analytics" className="underline text-neutral-600 hover:text-black">analytics →</Link>
          <span className="text-neutral-400">·</span>
          <a
            href="/api/host/export"
            className="underline text-neutral-600 hover:text-black"
            download
          >
            export all (csv)
          </a>
          <span className="text-neutral-400">·</span>
          <a
            href="/api/host/export/people"
            className="underline text-neutral-600 hover:text-black"
            download
          >
            people (csv)
          </a>
          <span className="text-neutral-400">·</span>
          <form action="/api/auth/signout" method="POST" className="inline">
            <button type="submit" className="underline text-neutral-600 hover:text-black">sign out</button>
          </form>
        </div>
      </header>

      {/* live now card */}
      {data.live?.length > 0 && (
        <div className="space-y-3 mb-8">
          {data.live.map((s) => (
            <div key={s.id} className="sticker rounded-md p-5" style={{ background: '#01ecf3', color: '#000' }}>
              <div className="flex items-center justify-between mb-4 gap-4">
                <div className="min-w-0">
                  <div className="text-[10px] uppercase tracking-widest font-bold mb-1 opacity-60 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-black animate-pulse"></span>
                    live right now
                  </div>
                  <div className="display text-2xl truncate">{s.name}</div>
                  <p className="text-sm opacity-70 mt-1">round {s.current_round} of {s.rounds_total} · {s.status.replace(/_/g, ' ')}</p>
                </div>
                <Link href={`/host/s/${s.id}`} className="display text-2xl no-underline whitespace-nowrap" style={{ color: '#000' }}>
                  open →
                </Link>
              </div>
              <CopyLink code={s.code} variant="oncyan" label="share this link with participants" />
            </div>
          ))}
        </div>
      )}

      {/* totals + sparklines */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="sessions hosted" value={data.totals.sessionsHosted} />
        <StatCard
          label="connections made"
          value={data.totals.totalConnections}
          highlight
          spark={data.trends?.captures}
        />
        <StatCard label="unique people" value={data.totals.totalParticipants} spark={data.trends?.attendance} />
        <StatCard label="newsletter opt-ins" value={data.totals.totalNewsletterOptIns} />
        <StatCard label="minutes hosted" value={data.totals.totalSessionMinutes} />
      </div>

      {/* newsletter sync card */}
      <div className="bg-white rounded-md p-4 mb-8 border border-neutral-200 flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">newsletter sync (kit)</div>
          <div className="text-sm mt-1">
            <strong style={{ color: '#01ecf3' }}>{data.newsletter.syncedThisMonth}</strong> emails synced this month
            {data.newsletter.lastSyncedAt && (
              <span className="text-neutral-500 ml-2">
                · last sync {new Date(data.newsletter.lastSyncedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        {data.newsletter.syncedThisMonth === 0 && (
          <span className="text-xs text-neutral-500 italic">[no syncs yet · check KIT_API_KEY in vercel if expected]</span>
        )}
      </div>

      {/* drafts */}
      {data.drafts.length > 0 && (
        <section className="mb-10">
          <h2 className="display text-xl mb-3">drafts</h2>
          <div className="grid gap-3">
            {data.drafts.map((s) => (
              <div key={s.id} className="sticker-sm bg-white rounded-md p-4">
                <div className="flex items-center justify-between mb-3 gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{s.name}</div>
                    <div className="text-xs text-neutral-500">draft · publish before sharing</div>
                  </div>
                  <div className="flex items-center gap-3 text-sm flex-shrink-0">
                    <Link href={`/host/new?id=${s.id}`} className="underline whitespace-nowrap">edit →</Link>
                    <button
                      onClick={() => handleDelete(s.id, s.name)}
                      className="text-red-500 hover:text-red-700 underline"
                      title="delete draft"
                    >
                      delete
                    </button>
                  </div>
                </div>
                <CopyLink code={s.code} variant="light" label="participant link (works once you go live)" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* top connectors */}
      {data.topConnectors?.length > 0 && (
        <section className="mb-10">
          <h2 className="display text-xl mb-3">top connectors</h2>
          <div className="bg-white rounded-md border border-neutral-200 overflow-hidden">
            <ul className="divide-y divide-neutral-200">
              {data.topConnectors.map((c, i) => (
                <li key={i} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{c.name}</div>
                    {c.email && <div className="text-xs text-neutral-500 truncate">{c.email}</div>}
                  </div>
                  <div className="text-sm font-bold flex-shrink-0" style={{ color: '#01ecf3' }}>
                    {c.captures} {c.captures === 1 ? 'capture' : 'captures'}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* past sessions */}
      <section>
        <div className="flex items-center justify-between mb-3 gap-4">
          <h2 className="display text-xl">past sessions</h2>
          <Link href="/host/new" className="btn-cyan px-5 py-3 rounded-md no-underline whitespace-nowrap">
            new session *
          </Link>
        </div>
        {data.past.length === 0 ? (
          <p className="text-neutral-500 italic">[no past sessions yet · run your first one and they'll show up here]</p>
        ) : (
          <div className="grid gap-3">
            {data.past.map((s) => (
              <div key={s.id} className="bg-white rounded-md p-4 border border-neutral-200">
                <div className="flex items-start justify-between gap-4 mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{s.name}</div>
                    <div className="text-xs text-neutral-500">
                      {new Date(s.created_at).toLocaleDateString()} · {s.rounds_total} round{s.rounds_total === 1 ? '' : 's'}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 text-sm flex-shrink-0">
                    <Link href={`/host/s/${s.id}`} className="underline whitespace-nowrap">recap →</Link>
                    <a
                      href={`/api/sessions/${s.id}/export`}
                      download
                      className="underline whitespace-nowrap text-neutral-600 hover:text-black"
                    >
                      csv
                    </a>
                    <button
                      onClick={() => handleDelete(s.id, s.name)}
                      className="text-red-500 hover:text-red-700 underline"
                      title="delete session"
                    >
                      delete
                    </button>
                  </div>
                </div>

                {/* inline stats */}
                <div className="flex items-center gap-4 text-xs flex-wrap mt-3 pt-3 border-t border-neutral-100">
                  <Stat label="attendance" value={s.attendance} />
                  <Stat label="captures" value={s.captures} highlight />
                  <Stat label="engagement" value={`${s.engagement_pct}%`} />
                  {(s.returning > 0 || s.newCount > 0) && (
                    <Stat label="people" value={`${s.returning} returning · ${s.newCount} new`} />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

// stat cards (top totals row)
function StatCard({ label, value, highlight, spark }) {
  return (
    <div
      className={`rounded-md p-4 flex flex-col justify-between gap-2 ${highlight ? 'sticker' : 'bg-white border border-neutral-200'}`}
      style={highlight ? { background: '#01ecf3' } : {}}
    >
      <div className="text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div className="display text-2xl md:text-3xl leading-none">{value}</div>
        {spark && spark.length > 0 && (
          <Sparkline data={spark} width={60} height={20} color={highlight ? '#000' : '#01ecf3'} />
        )}
      </div>
    </div>
  );
}

// inline mini-stat for past session cards
function Stat({ label, value, highlight }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <span className="text-neutral-500">{label}:</span>
      <span className={`font-bold ${highlight ? '' : 'text-black'}`} style={highlight ? { color: '#01ecf3' } : {}}>{value}</span>
    </div>
  );
}
