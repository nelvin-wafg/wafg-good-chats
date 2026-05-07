import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { deleteRoom } from '@/lib/daily';

// DELETE /api/sessions/:id  — any approved host can delete a session.
// hard delete · cascades to remove participants, pairings, rounds, captures.
// also cleans up any active daily.co rooms.
export async function DELETE(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, host_id, main_room_name')
    .eq('id', params.id)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });

  // delete is destructive · only the primary host (creator) can do it.
  // co-hosts can manage the session live but can't permanently destroy data.
  if (session.host_id !== auth.user.id) {
    return new NextResponse('only the primary host can delete this session', { status: 403 });
  }

  // best-effort daily room cleanup (don't block delete on these)
  if (session.main_room_name) {
    try { await deleteRoom(session.main_room_name); } catch {}
  }
  const { data: pairings = [] } = await admin
    .from('pairings')
    .select('room_name')
    .eq('session_id', session.id);
  await Promise.all(
    pairings
      .filter((p) => p.room_name)
      .map((p) => deleteRoom(p.room_name).catch(() => {}))
  );

  // hard delete · cascades to participants/pairings/rounds/captures
  const { error } = await admin.from('sessions').delete().eq('id', session.id);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
