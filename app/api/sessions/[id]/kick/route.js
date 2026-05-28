import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/kick  body: { participantId }
// host-initiated removal. the host's tab does the actual Daily eject (it has the
// call object); this endpoint just marks the participant absent in the DB so the
// host views update immediately and the participant doesn't appear in re-pairings.
// the participant could still rejoin via the session link · the user asked for
// "just eject" semantics rather than a permanent block.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, participantId;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    participantId = validateUuid(body?.participantId, 'participant id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { error } = await admin
    .from('participants')
    .update({
      is_present: false,
      current_room_name: null,
      left_at: new Date().toISOString(),
    })
    .eq('id', participantId)
    .eq('session_id', sessionId);

  if (error) {
    console.error('[kick] update failed', error);
    return new NextResponse('could not kick', { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
