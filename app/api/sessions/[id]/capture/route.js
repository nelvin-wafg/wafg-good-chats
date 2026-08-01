import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { rateLimitByIp } from '@/lib/rate-limit';
import { validateParticipantName, validateNote, validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/capture
// body: { pairingId?, partnerName?, note? }
// capturer identity comes from the HttpOnly cookie · NEVER from request body.
// partner is resolved from the pairing (authoritative · names can collide).
// partnerName is only a fallback for the rare case of a missing pairingId.
export async function POST(request, { params }) {
  const allowed = await rateLimitByIp(request, 'capture', { limit: 30, windowSeconds: 300 });
  if (!allowed) return new NextResponse('too many requests', { status: 429 });

  let sessionId;
  let partnerName = null;
  let pairingId = null;
  let note = null;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    if (body?.partnerName) partnerName = validateParticipantName(body.partnerName);
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

  // resolve the partner participant id — prefer the pairing (correct even with duplicate names)
  let partnerId = null;
  if (pairingId) {
    const { data: pairing } = await admin
      .from('pairings')
      .select('participant_a_id, participant_b_id')
      .eq('id', pairingId)
      .eq('session_id', sessionId)
      .maybeSingle();
    if (pairing) {
      // the partner is whichever side of the pairing isn't me
      if (pairing.participant_a_id === me.participantId) partnerId = pairing.participant_b_id;
      else if (pairing.participant_b_id === me.participantId) partnerId = pairing.participant_a_id;
      else return new NextResponse('not part of this pairing', { status: 403 });
    }
  }

  // fetch the partner by id (preferred) or fall back to name lookup
  let partner = null;
  if (partnerId) {
    const { data } = await admin
      .from('participants')
      .select('id, name, profiles(email, linkedin_url)')
      .eq('id', partnerId)
      .eq('session_id', sessionId)
      .maybeSingle();
    partner = data;
  } else if (partnerName) {
    // fallback path (pairingId missing/stale): still require a real pairing
    // relationship in this session — a bare name match with no pairing check
    // would let anyone "capture" (and harvest the linkedin_url of) any attendee
    // they were never actually paired with.
    const { data: myPairings } = await admin
      .from('pairings')
      .select('participant_a_id, participant_b_id')
      .eq('session_id', sessionId)
      .or(`participant_a_id.eq.${me.participantId},participant_b_id.eq.${me.participantId}`);

    const partnerIds = (myPairings || [])
      .map((p) => (p.participant_a_id === me.participantId ? p.participant_b_id : p.participant_a_id))
      .filter(Boolean);

    if (partnerIds.length > 0) {
      const { data } = await admin
        .from('participants')
        .select('id, name, profiles(email, linkedin_url)')
        .eq('session_id', sessionId)
        .eq('name', partnerName)
        .in('id', partnerIds)
        .limit(1)
        .maybeSingle();
      partner = data;
    }
  }

  if (!partner) return new NextResponse('partner not found', { status: 404 });
  if (partner.id === me.participantId) {
    return new NextResponse('cannot capture yourself', { status: 400 });
  }

  // snapshot captured person's profile fields at capture time so the recap survives
  // future profile edits
  const { error } = await admin
    .from('captures')
    .insert({
      session_id: sessionId,
      capturer_id: me.participantId,
      captured_id: partner.id,
      pairing_id: pairingId,
      captured_name: partner.name,
      captured_email: partner.profiles?.email || null,
      captured_linkedin_url: partner.profiles?.linkedin_url || null,
      note,
    });

  if (error) return new NextResponse('could not save capture', { status: 500 });
  return NextResponse.json({ ok: true });
}
