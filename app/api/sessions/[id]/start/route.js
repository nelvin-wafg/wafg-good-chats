import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { createRoom } from '@/lib/daily';

// POST /api/sessions/:id/start  — flip from draft → live and provision the main daily room.
// any approved host can start any session (co-host enabled).
export async function POST(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('not an approved host', { status: 403 });

  const admin = adminClient();
  const { data: session, error } = await admin
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single();
  if (error || !session) return new NextResponse('session not found', { status: 404 });
  if (session.status !== 'draft' && session.status !== 'live') {
    return new NextResponse('session already started', { status: 400 });
  }

  // create the main daily room if not already
  let mainRoomName = session.main_room_name;
  if (!mainRoomName) {
    const room = await createRoom({
      name: `wafg-main-${session.code}-${Date.now().toString(36)}`,
      expMinutes: Math.max(120, (session.rounds_total + 2) * Math.ceil(session.round_seconds / 60) + 30),
      isMain: true,
    });
    mainRoomName = room.name;
  }

  await admin
    .from('sessions')
    .update({ status: 'live', main_room_name: mainRoomName })
    .eq('id', session.id);

  return NextResponse.json({ ok: true, mainRoomName });
}
