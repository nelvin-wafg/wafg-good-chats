'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { SparkBars } from '@/components/Sparkline';
import { showToast } from '@/components/Toast';

export default function AnalyticsPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/host/analytics', { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch((e) => { showToast(e.message || 'load failed', 'error'); setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <main className="min-h-screen p-8" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[loading analytics...]</p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="min-h-screen p-8" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[couldn't load analytics]</p>
        <Link href="/host" className="text-sm underline mt-4 inline-block">← back to dashboard</Link>
      </main>
    );
  }

  const monthLabels = data.sessionsByMonth.map((m) => m.month.slice(5));
  const monthCounts = data.sessionsByMonth.map((m) => m.count);

  // recent sessions for trend display (most recent 12)
  const recentSessions = (data.perSession || []).slice(-12);
  const sessionLabels = recentSessions.map((s) => (s.name || s.code || '').slice(0, 8));
  const captureSeries = recentSessions.map((s) => s.captures);
  const attendanceSeries = recentSessions.map((s) => s.attendance);
  const engagementSeries = recentSessions.map((s) => s.engagement_pct);

  return (
    <main className="min-h-screen p-6 md:p-8 max-w-6xl mx-auto" style={{ background: '#f4f4f1' }}>

      <header className="flex items-start justify-between mb-8 gap-4">
        <div>
          <Link href="/host" className="text-sm underline text-neutral-600">← dashboard</Link>
          <div className="display text-3xl md:text-4xl mt-2">analytics <span style={{ color: '#01ecf3' }}>*</span></div>
          <p className="text-sm text-neutral-500 mt-1">your sessions, your data, what's working.</p>
        </div>
      </header>

      {recentSessions.length === 0 ? (
        <div className="bg-white rounded-md p-8 border border-neutral-200 text-center">
          <p className="text-neutral-600">no sessions ended yet · run your first one and analytics will populate here.</p>
        </div>
      ) : (
        <div className="space-y-8">

          <ChartCard title="sessions per month" subtitle="last 12 months">
            <SparkBars data={monthCounts} labels={monthLabels} height={180} />
          </ChartCard>

          <ChartCard title="captures per session" subtitle="recent 12 sessions, oldest to newest">
            <SparkBars data={captureSeries} labels={sessionLabels} height={200} />
          </ChartCard>

          <ChartCard title="attendance per session" subtitle="people who joined">
            <SparkBars data={attendanceSeries} labels={sessionLabels} height={200} />
          </ChartCard>

          <ChartCard title="engagement rate per session" subtitle="% of attendees who captured at least one connection">
            <SparkBars data={engagementSeries} labels={sessionLabels} height={200} />
          </ChartCard>

          {data.topPrompts?.length > 0 && (
            <ChartCard title="top prompts" subtitle="prompts that drove the most captures across all sessions">
              <ul className="divide-y divide-neutral-200">
                {data.topPrompts.map((p, i) => (
                  <li key={i} className="py-3 flex items-start justify-between gap-3">
                    <div className="text-sm min-w-0 flex-1">{p.prompt}</div>
                    <div className="text-sm font-bold flex-shrink-0" style={{ color: '#01ecf3' }}>
                      {p.captures} {p.captures === 1 ? 'capture' : 'captures'}
                    </div>
                  </li>
                ))}
              </ul>
            </ChartCard>
          )}

          <ChartCard title="all sessions" subtitle="full breakdown">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-widest font-bold text-neutral-500 border-b border-neutral-200">
                    <th className="py-2">session</th>
                    <th className="py-2">date</th>
                    <th className="py-2 text-right">attendance</th>
                    <th className="py-2 text-right">captures</th>
                    <th className="py-2 text-right">engagement</th>
                  </tr>
                </thead>
                <tbody>
                  {data.perSession.map((s) => (
                    <tr key={s.id} className="border-b border-neutral-100">
                      <td className="py-2">
                        <Link href={`/host/s/${s.id}`} className="font-medium hover:underline">{s.name}</Link>
                      </td>
                      <td className="py-2 text-neutral-500 text-xs">
                        {s.ended_at ? new Date(s.ended_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="py-2 text-right">{s.attendance}</td>
                      <td className="py-2 text-right font-semibold" style={{ color: '#01ecf3' }}>{s.captures}</td>
                      <td className="py-2 text-right">{s.engagement_pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        </div>
      )}
    </main>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <section className="bg-white rounded-md p-5 border border-neutral-200">
      <div className="mb-3">
        <h2 className="display text-lg">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}
