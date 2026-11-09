import { adminClient } from '@/lib/supabase-server';
import RoomExperience from './RoomExperience';

export default async function RoomPage({ params }) {
  const supabase = adminClient();
  const { data: session } = await supabase
    .from('sessions')
    .select('id, code, name, status, rounds_total, round_seconds, break_seconds, current_round')
    .eq('code', params.code)
    .single();

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center text-white" style={{ background: '#000' }}>
        <div className="text-center">
          <div className="display text-4xl mb-2">Session not found.</div>
          <p className="text-neutral-400">[The code might be wrong, or the session was deleted]</p>
        </div>
      </main>
    );
  }

  return <RoomExperience session={session} />;
}
