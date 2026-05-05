import Link from 'next/link';
import { createClient } from '@/lib/supabase-server';
import CopyLink from '@/components/CopyLink';

export const dynamic = 'force-dynamic';

export default async function HostDashboard() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: host } = await supabase.from('hosts').select('display_name, email').eq('id', user.id).single();

  const { data: sessions = [] } = await supabase
    .from('sessions')
    .select('id, code, name, status, rounds_total, created_at, ended_at, current_round')
    .order('created_at', { ascending: false })
    .limit(20);

  const live = (sessions || []).find((s) => ['live', 'running_round', 'between_rounds'].includes(s.status));
  const past = (sessions || []).filter((s) => s.status === 'ended');
  const drafts = (sessions || []).filter((s) => s.status === 'draft');

  // year-to-date connections (sum of captures across this host's sessions)
  const sessionIds = (sessions || []).map((s) => s.id);
  let totalConnections = 0;
  if (sessionIds.length) {
    const { count } = await supabase
      .from('captures')
      .select('id', { count: 'exact', head: true })
      .in('session_id', sessionIds);
    totalConnections = count || 0;
  }

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto" style={{ background: '#f4f4f1' }}>
      <header className="flex items-center justify-between mb-10">
        <div>
          <div className="text-xs uppercase tracking-widest font-bold text-neutral-500">spread good chats · host</div>
          <div className="display text-4xl mt-1">hey {host?.display_name || 'friend'} <span style={{ color: '#01ecf3' }}>*</span></div>
        </div>
        <form action="/api/auth/signout" method="POST">
          <button type="submit" className="text-sm underline text-neutral-600 hover:text-black">sign out</button>
        </form>
      </header>

      {/* live session */}
      {live && (
        <div className="mb-8 sticker rounded-md p-5" style={{ background: '#01ecf3', color: '#000' }}>
          <div className="flex items-center justify-between mb-4 gap-4">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest font-bold mb-1 opacity-60 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-black animate-pulse"></span>
                live right now
              </div>
              <div className="display text-2xl truncate">{live.name}</div>
              <p className="text-sm opacity-70 mt-1">round {live.current_round} of {live.rounds_total}</p>
            </div>
            <Link href={`/host/s/${live.id}`} className="display text-2xl no-underline whitespace-nowrap" style={{ color: '#000' }}>
              open →
            </Link>
          </div>
          <CopyLink code={live.code} variant="oncyan" label="share this link with participants" />
        </div>
      )}

      {/* stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        <Stat label="sessions hosted" value={(sessions || []).filter((s) => s.status === 'ended').length} />
        <Stat label="your people made" value={`${totalConnections} connections`} highlight />
        <Stat label="this year" value={new Date().getFullYear()} />
      </div>

      {/* drafts */}
      {drafts.length > 0 && (
        <section className="mb-10">
          <h2 className="display text-xl mb-3">drafts</h2>
          <div className="grid gap-3">
            {drafts.map((s) => (
              <div key={s.id} className="sticker-sm bg-white rounded-md p-4">
                <div className="flex items-center justify-between mb-3 gap-4">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{s.name}</div>
                    <div className="text-xs text-neutral-500">draft · publish before sharing</div>
                  </div>
                  <Link href={`/host/new?id=${s.id}`} className="text-sm underline whitespace-nowrap">edit →</Link>
                </div>
                <CopyLink code={s.code} variant="light" label="participant link (works once you go live)" />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* past */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="display text-xl">past sessions</h2>
          <Link href="/host/new" className="btn-cyan px-5 py-3 rounded-md no-underline">new session *</Link>
        </div>
        {past.length === 0 ? (
          <p className="text-neutral-500 italic">[no past sessions yet · run your first one and they'll show up here]</p>
        ) : (
          <div className="grid gap-3">
            {past.map((s) => (
              <div key={s.id} className="bg-white rounded-md p-4 flex items-center justify-between border border-neutral-200">
                <div>
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-xs text-neutral-500">{new Date(s.created_at).toLocaleDateString()} · {s.rounds_total} rounds</div>
                </div>
                <Link href={`/host/s/${s.id}`} className="text-sm underline">recap →</Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-md p-4 ${highlight ? 'sticker' : 'bg-white border border-neutral-200'}`} style={highlight ? { background: '#01ecf3' } : {}}>
      <div className="text-[10px] uppercase tracking-widest font-bold opacity-60">{label}</div>
      <div className="display text-3xl mt-1">{value}</div>
    </div>
  );
}
