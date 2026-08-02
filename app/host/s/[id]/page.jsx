import { createClient } from '@/lib/supabase-server';
import LiveControl from './LiveControl';

export const dynamic = 'force-dynamic';

export default async function HostSessionPage({ params }) {
  const supabase = createClient();
  const { data: session } = await supabase
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
