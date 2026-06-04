'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import CopyLink from '@/components/CopyLink';
import Sparkline from '@/components/Sparkline';
import StoryModal from '@/components/StoryModal';
import { showToast } from '@/components/Toast';

export default function HostDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // stat-card drill-in: one of null | 'sessions' | 'captures' | 'people' | 'newsletter' | 'minutes'
  const [activeStat, setActiveStat] = useState(null);
  const [details, setDetails] = useState(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [showStory, setShowStory] = useState(false);

  useEffect(() => {
    if (!activeStat) { setDetails(null); return; }
    let cancelled = false;
    setDetailsLoading(true);
    setDetails(null);
    fetch(`/api/host/dashboard/details?kind=${activeStat}`, { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) { setDetails(d); setDetailsLoading(false); } })
      .catch(() => { if (!cancelled) { setDetailsLoading(false); } });
    return () => { cancelled = true; };
  }, [activeStat]);

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

  async function handleDeletePerson(connector) {
    const label = connector.name || connector.email || 'this person';
    if (!confirm(`delete ${label} permanently? this removes their profile and every record of them across all your sessions (participant rows, captures). cannot be undone.`)) return;
    try {
      const res = await fetch('/api/host/people', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          profileId: connector.profile_id || null,
          participantId: connector.profile_id ? null : connector.participant_id,
        }),
      });
      if (!res.ok) {
        showToast(await res.text() || "couldn't delete", 'error');
        return;
      }
      showToast(`${label} removed`, 'success');
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
          <div className="text-xs uppercase tracking-widest font-bold text-neutral-500">Good Chats · host</div>
          <div className="display text-3xl md:text-4xl mt-1">
            hey {data.host?.display_name || 'friend'} <span style={{ color: '#01ecf3' }}>*</span>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0 text-sm">
          <button
            type="button"
            onClick={() => setShowStory(true)}
            className="underline text-neutral-600 hover:text-black"
            title="how this project has evolved"
          >
            the story →
          </button>
          <span className="text-neutral-400">·</span>
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
        <StatCard label="sessions hosted" value={data.totals.sessionsHosted} onClick={() => setActiveStat('sessions')} />
        <StatCard
          label="connections made"
          value={data.totals.totalConnections}
          highlight
          spark={data.trends?.captures}
          onClick={() => setActiveStat('captures')}
        />
        <StatCard label="unique people" value={data.totals.totalParticipants} spark={data.trends?.attendance} onClick={() => setActiveStat('people')} />
        <StatCard label="newsletter opt-ins" value={data.totals.totalNewsletterOptIns} onClick={() => setActiveStat('newsletter')} />
        <StatCard label="minutes hosted" value={data.totals.totalSessionMinutes} onClick={() => setActiveStat('minutes')} />
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
                  <div className="flex items-center gap-4 flex-shrink-0">
                    <div className="text-sm font-bold" style={{ color: '#01ecf3' }}>
                      {c.captures} {c.captures === 1 ? 'capture' : 'captures'}
                    </div>
                    <button
                      onClick={() => handleDeletePerson(c)}
                      className="text-xs text-red-500 hover:text-red-700 underline"
                      title={`permanently delete ${c.name}`}
                    >
                      delete
                    </button>
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

      {activeStat && (
        <StatDetailsModal
          kind={activeStat}
          details={details}
          loading={detailsLoading}
          onClose={() => setActiveStat(null)}
        />
      )}

      {showStory && <StoryModal onClose={() => setShowStory(false)} />}
    </main>
  );
}

// stat cards (top totals row)
function StatCard({ label, value, highlight, spark, onClick }) {
  const clickable = typeof onClick === 'function';
  const Tag = clickable ? 'button' : 'div';
  return (
    <Tag
      type={clickable ? 'button' : undefined}
      onClick={clickable ? onClick : undefined}
      className={`rounded-md p-4 flex flex-col justify-between gap-2 text-left ${highlight ? 'sticker' : 'bg-white border border-neutral-200'} ${clickable ? 'hover:opacity-90 hover:translate-y-[-1px] transition-all cursor-pointer' : ''}`}
      style={highlight ? { background: '#01ecf3' } : {}}
      title={clickable ? `view ${label} details` : undefined}
    >
      <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 flex items-center justify-between gap-1">
        <span>{label}</span>
        {clickable && <span className="opacity-50">→</span>}
      </div>
      <div className="flex items-end justify-between gap-2">
        <div className="display text-2xl md:text-3xl leading-none">{value}</div>
        {spark && spark.length > 0 && (
          <Sparkline data={spark} width={60} height={20} color={highlight ? '#000' : '#01ecf3'} />
        )}
      </div>
    </Tag>
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

// modal that backs each clickable stat card
function StatDetailsModal({ kind, details, loading, onClose }) {
  const title = {
    sessions: 'sessions hosted',
    captures: 'connections made',
    people: 'unique people',
    newsletter: 'newsletter opt-ins',
    minutes: 'minutes hosted',
  }[kind] || kind;

  function fmtDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString(); } catch { return ''; }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-start justify-center p-4 z-50 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-md w-full max-w-3xl my-8 sticker" style={{ color: '#000' }}>
        <div className="flex items-center justify-between p-5 border-b border-neutral-200">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">details</div>
            <div className="display text-2xl">{title}</div>
          </div>
          <button onClick={onClose} className="text-2xl text-neutral-500 hover:text-black leading-none" title="close">×</button>
        </div>
        <div className="p-5">
          {loading && <p className="text-sm text-neutral-500 italic">[loading...]</p>}
          {!loading && details && details.rows && details.rows.length === 0 && (
            <p className="text-sm text-neutral-500 italic">[nothing to show yet]</p>
          )}
          {!loading && details && details.rows && details.rows.length > 0 && (
            <div className="overflow-x-auto">
              {kind === 'sessions' && (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 text-left">
                    <tr><th className="py-2 pr-3">session</th><th className="py-2 pr-3">date</th><th className="py-2 pr-3">status</th><th className="py-2 pr-3">rounds</th><th className="py-2 pr-3">attendance</th><th className="py-2">captures</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {details.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-semibold">{r.name}</td>
                        <td className="py-2 pr-3 text-neutral-500">{fmtDate(r.date)}</td>
                        <td className="py-2 pr-3 text-neutral-500">{(r.status || '').replace(/_/g, ' ')}</td>
                        <td className="py-2 pr-3">{r.rounds}</td>
                        <td className="py-2 pr-3">{r.attendance}</td>
                        <td className="py-2 font-bold" style={{ color: '#01ecf3' }}>{r.captures}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {kind === 'captures' && (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 text-left">
                    <tr><th className="py-2 pr-3">who captured</th><th className="py-2 pr-3">who they captured</th><th className="py-2 pr-3">session</th><th className="py-2">when</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {details.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-semibold">{r.capturer}</td>
                        <td className="py-2 pr-3">
                          <div>{r.captured}</div>
                          {r.captured_email && <div className="text-xs text-neutral-500">{r.captured_email}</div>}
                        </td>
                        <td className="py-2 pr-3 text-neutral-500">{r.session_name}</td>
                        <td className="py-2 text-neutral-500">{fmtDate(r.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {(kind === 'people' || kind === 'newsletter') && (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 text-left">
                    <tr><th className="py-2 pr-3">name</th><th className="py-2 pr-3">email</th><th className="py-2 pr-3">events</th><th className="py-2 pr-3">opt-in</th><th className="py-2">last seen</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {details.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-semibold">{r.name}</td>
                        <td className="py-2 pr-3 text-neutral-500">{r.email}</td>
                        <td className="py-2 pr-3">{r.events_attended}</td>
                        <td className="py-2 pr-3">{r.newsletter_opt_in ? 'yes' : 'no'}</td>
                        <td className="py-2 text-neutral-500">{fmtDate(r.last_seen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {kind === 'minutes' && (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 text-left">
                    <tr><th className="py-2 pr-3">session</th><th className="py-2 pr-3">date</th><th className="py-2 pr-3">rounds</th><th className="py-2">minutes</th></tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {details.rows.map((r) => (
                      <tr key={r.id}>
                        <td className="py-2 pr-3 font-semibold">{r.name}</td>
                        <td className="py-2 pr-3 text-neutral-500">{fmtDate(r.date)}</td>
                        <td className="py-2 pr-3">{r.rounds}</td>
                        <td className="py-2 font-bold" style={{ color: '#01ecf3' }}>{r.minutes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
