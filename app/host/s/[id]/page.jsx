import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import LiveControl from './LiveControl';

export const dynamic = 'force-dynamic';

export default async function HostSessionPage({ params }) {
  // co-hosting is intentionally "any approved host can run any session" (see
  // lib/auth.js) — every other host route enforces that with getApprovedHost()
  // + adminClient(). this page previously queried `sessions` through the
  // cookie-scoped anon client, which is bound by RLS's owner-only policy
  // (auth.uid() = host_id) · that's correct for RLS's own predicate, but it
  // meant a co-host opening a session they didn't personally create saw
  // "session not found" even though every action on the dashboard itself
  // would have worked fine for them.
  const auth = await getApprovedHost();
  if (!auth) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: '#f4f4f1', color: '#000' }}>
        <div className="text-center">
          <div className="display text-4xl">not signed in.</div>
          <a href="/host/login" className="text-sm underline mt-4 inline-block text-neutral-500">sign in</a>
        </div>
      </main>
    );
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single();

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: '#f4f4f1', color: '#000' }}>
        <div className="text-center">
          <div className="display text-4xl">session not found.</div>
          <a href="/host" className="text-sm underline mt-4 inline-block text-neutral-500">back to dashboard</a>
        </div>
      </main>
    );
  }

  return <LiveControl session={session} />;
}
