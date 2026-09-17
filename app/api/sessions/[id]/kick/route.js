import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';
import { logAuditEvent } from '@/lib/audit';

// POST /api/sessions/:id/kick  body: { participantId, auto? }
// host-initiated removal. the host's tab does the actual Daily eject (it has the
// call object); this endpoint just marks the participant absent in the DB so the
// host views update immediately and the participant doesn't appear in re-pairings.
// the participant could still rejoin via the session link · the user asked for
// "just eject" semantics rather than a permanent block.
//
// kicked_at is what makes a REAL kick stick: without it, a still-open tab from
// the kicked participant keeps sending state-poll heartbeats, which would
// otherwise silently flip is_present back to true. see the heartbeat guard in
// app/api/sessions/[id]/state/route.js and the clear-on-rejoin in join/route.js.
//
// auto:true is a DIFFERENT thing: the host dashboard's own stale-presence
// cleanup calls this same endpoint to mark someone absent after their heartbeat
// goes quiet for a while (a real disconnect, or just a rough wifi patch — the
// dashboard can't tell which). that is NOT the host choosing to remove someone,
// so it must not set kicked_at: doing so previously caused a participant whose
// connection merely blipped to be permanently flagged "kicked" and shown "the
// host removed you from this session" the moment their tab's next poll saw
// kicked:true — even though no host ever touched anything. leaving kicked_at
// null here means the SAME heartbeat gate that protects a real kick also lets a
// genuine reconnect silently restore is_present on its own, no rejoin needed.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, participantId, auto;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    participantId = validateUuid(body?.participantId, 'participant id');
    auto = Boolean(body?.auto);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const update = {
    is_present: false,
    current_room_name: null,
    left_at: new Date().toISOString(),
  };
  if (!auto) update.kicked_at = new Date().toISOString();

  const { error } = await admin
    .from('participants')
    .update(update)
    .eq('id', participantId)
    .eq('session_id', sessionId);

  if (error) {
    console.error('[kick] update failed', error);
    return new NextResponse('could not kick', { status: 500 });
  }

  logAuditEvent({
    eventType: auto ? 'participant.marked_absent' : 'participant.kicked',
    actorId: auth.user.id,
    actorLabel: auto ? 'system (stale presence)' : (auth.host.display_name || auth.host.email),
    sessionId,
    targetId: participantId,
  });

  return NextResponse.json({ ok: true });
}
