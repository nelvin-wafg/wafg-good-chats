import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { validateUuid, ValidationError } from '@/lib/validate';
import { rateLimitByIp } from '@/lib/rate-limit';

const ALLOWED_EVENT_TYPES = new Set([
  'network-quality-change',
  'network-connection',
  'track-state-change',
]);

// POST /api/sessions/:id/diagnostics  body: { eventType, payload?, subjectParticipantId? }
//
// lightweight WebRTC connection-health logging, so "someone couldn't hear
// anyone" turns into a two-minute lookup instead of a mystery. two kinds of
// callers write here:
//   - a participant's own client, reporting its OWN connection (subjectParticipantId
//     is ignored for these · always tagged with the caller's real, cookie-verified
//     identity, so one participant can't attribute noise to someone else).
//   - the host's client, reporting either its own connection (no subject) or what
//     it's observing about a REMOTE participant via daily-js's participant-updated
//     event (subjectParticipantId = that participant's real app id).
export async function POST(request, { params }) {
  // generous limit: the host's client can legitimately fire several of these in
  // one burst (e.g. many participants' baseline network/track state all
  // reporting at once right after a round starts) and this data is exactly
  // the point of this endpoint, so don't be stingy about it.
  const ok = await rateLimitByIp(request, 'diagnostics', { limit: 120, windowSeconds: 60 });
  if (!ok) return new NextResponse('too many diagnostic events', { status: 429 });

  let sessionId, eventType, payload, subjectParticipantId;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    eventType = String(body?.eventType || '');
    if (!ALLOWED_EVENT_TYPES.has(eventType)) {
      return new NextResponse('unknown event type', { status: 400 });
    }
    payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};
    // cap payload size so a malformed/misbehaving client can't write unbounded jsonb
    if (JSON.stringify(payload).length > 2000) payload = { truncated: true };
    subjectParticipantId = body?.subjectParticipantId
      ? validateUuid(body.subjectParticipantId, 'subject participant id')
      : null;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  const hostAuth = !me ? await getApprovedHost() : null;
  if (!me && !hostAuth) return new NextResponse('forbidden', { status: 403 });

  const admin = adminClient();
  const { error } = await admin.from('connection_events').insert({
    session_id: sessionId,
    // a participant can only ever tag themselves · subjectParticipantId only
    // takes effect for host-originated calls, reporting about someone else.
    participant_id: me ? me.participantId : subjectParticipantId,
    role: me ? 'participant' : 'host',
    event_type: eventType,
    payload,
  });
  if (error) {
    console.error('[diagnostics] insert failed', error);
    return new NextResponse('could not log event', { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

// GET /api/sessions/:id/diagnostics — host-only, recent connection-health events
// for this session, most recent first. used by the live dashboard's connection
// log panel so a host can look up "why couldn't X hear anyone" during or after
// the event instead of relying on a verbal report alone.
export async function GET(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: events = [] } = await admin
    .from('connection_events')
    .select('id, participant_id, role, event_type, payload, created_at, participants(name)')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false })
    .limit(100);

  return NextResponse.json({
    events: (events || []).map((e) => ({
      id: e.id,
      name: e.participants?.name || (e.role === 'host' ? 'host' : 'unknown'),
      role: e.role,
      eventType: e.event_type,
      payload: e.payload,
      createdAt: e.created_at,
    })),
  });
}
