import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { validateParticipantName, validateNote, validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/capture
// body: { partnerName, pairingId?, note? }
// capturer identity comes from the HttpOnly cookie · NEVER from request body.
export async function POST(request, { params }) {
  let sessionId;
  let partnerName;
  let pairingId = null;
  let note = null;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    partnerName = validateParticipantName(body?.partnerName);
    if (body?.pairingId) pairingId = validateUuid(body.pairingId, 'pairing id');
    if (body?.note != null) note = validateNote(body.note);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  // verify capturer identity from cookie
  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  if (!me) return new NextResponse('not authenticated · join the session first', { status: 401 });

  const admin = adminClient();

  // resolve partner participant id by name in this session
  // note: name match is best-effort; if multiple participants share a name we pick the first.
  // for v2, pass partnerId explicitly from the client (also via signed structure).
  const { data: partner } = await admin
    .from('participants')
    .select('id')
    .eq('session_id', sessionId)
    .eq('name', partnerName)
    .limit(1)
    .single();

  if (!partner) return new NextResponse('partner not found', { status: 404 });
  if (partner.id === me.participantId) {
    return new NextResponse('cannot capture yourself', { status: 400 });
  }

  const { error } = await admin
    .from('captures')
    .insert({
      session_id: sessionId,
      capturer_id: me.participantId,
      captured_id: partner.id,
      pairing_id: pairingId,
      note,
    });

  if (error) return new NextResponse('could not save capture', { status: 500 });
  return NextResponse.json({ ok: true });
}
