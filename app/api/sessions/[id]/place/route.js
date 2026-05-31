import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/place  body: { participantId, roomName }
// host-initiated · drops a participant into a specific live pair room.
// used for orphans (partner dropped), late joiners, or anyone in the main room
// the host wants to slot into an existing conversation.
//
// implementation: just sets participants.current_room_name. the state route
// gives that priority over normal pairing membership when building the
// participant's assignment, and the daily token route allows the placed
// participant to join the room.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, participantId, roomName;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    participantId = validateUuid(body?.participantId, 'participant id');
    roomName = body?.roomName;
    if (typeof roomName !== 'string' || !roomName || roomName.length > 100) {
      return new NextResponse('roomName required', { status: 400 });
    }
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();

  // confirm the session is in a state where placement makes sense
  const { data: session } = await admin
    .from('sessions')
    .select('id, status, current_round')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });
  if (session.status !== 'running_round') {
    return new NextResponse('placement only works during a running round', { status: 400 });
  }

  // verify the room is a real current-round pair room for this session
  const { data: roundRow } = await admin
    .from('rounds')
    .select('id')
    .eq('session_id', sessionId)
    .eq('round_number', session.current_round)
    .maybeSingle();
  if (!roundRow) return new NextResponse('round not found', { status: 404 });
  const { data: pairing } = await admin
    .from('pairings')
    .select('id, room_name')
    .eq('round_id', roundRow.id)
    .eq('room_name', roomName)
    .maybeSingle();
  if (!pairing) {
    return new NextResponse('room is not a current-round pair room', { status: 400 });
  }

  // verify the participant is in this session
  const { data: participant } = await admin
    .from('participants')
    .select('id')
    .eq('id', participantId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (!participant) return new NextResponse('participant not found', { status: 404 });

  // stamp the placement · state route will pick it up on next poll
  const { error } = await admin
    .from('participants')
    .update({ current_room_name: roomName, is_present: true })
    .eq('id', participantId);
  if (error) {
    console.error('[place] update failed', error);
    return new NextResponse('could not place participant', { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
