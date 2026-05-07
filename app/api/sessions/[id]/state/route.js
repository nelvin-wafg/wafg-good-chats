import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient, createClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { validateUuid, ValidationError } from '@/lib/validate';

// GET /api/sessions/:id/state
// returns the current session state.
// participant identity (if any) comes from the HttpOnly cookie · we never trust query params for identity.
// query param ?host=1 enables host view (requires authenticated approved host).
export async function GET(request, { params }) {
  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const url = new URL(request.url);
  const isHostView = url.searchParams.get('host') === '1';

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .single();

  if (!session) return new NextResponse('not found', { status: 404 });

  // host view requires authenticated host (and not just any host — the session's host).
  if (isHostView) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new NextResponse('not authenticated', { status: 401 });
    if (session.host_id !== user.id) return new NextResponse('forbidden', { status: 403 });
  }

  const { data: rawParticipants = [] } = await admin
    .from('participants')
    .select('id, name, is_present, current_room_name, joined_at, profiles(linkedin_url)')
    .eq('session_id', session.id)
    .order('joined_at', { ascending: true });
  const participants = (rawParticipants || []).map((p) => ({
    id: p.id,
    name: p.name,
    is_present: p.is_present,
    current_room_name: p.current_room_name,
    joined_at: p.joined_at,
    linkedin_url: p.profiles?.linkedin_url || null,
  }));

  // identify the calling participant (if any) from the cookie.
  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  const participantId = me?.participantId || null;

  let assignment = null;
  if (participantId && session.status === 'running_round') {
    const { data: pairings = [] } = await admin
      .from('pairings')
      .select('id, participant_a_id, participant_b_id, room_name, room_label, round_id, rounds!inner(round_number, prompt_text, started_at)')
      .eq('session_id', session.id)
      .eq('rounds.round_number', session.current_round);

    const myPairing = pairings.find(
      (p) => p.participant_a_id === participantId || p.participant_b_id === participantId
    );
    if (myPairing) {
      const startedAt = new Date(myPairing.rounds.started_at).getTime();
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      const secondsRemaining = Math.max(0, session.round_seconds - elapsed);

      if (myPairing.room_name && myPairing.participant_b_id) {
        // standard pair room
        const partnerId = myPairing.participant_a_id === participantId
          ? myPairing.participant_b_id
          : myPairing.participant_a_id;
        const partner = participants.find((p) => p.id === partnerId);
        assignment = {
          pairingId: myPairing.id,
          roomName: myPairing.room_name,
          roomLabel: myPairing.room_label,
          partnerName: partner?.name || 'your match',
          partnerLinkedinUrl: partner?.linkedin_url || null,
          prompt: myPairing.rounds.prompt_text,
          secondsRemaining,
          isWithHost: false,
        };
      } else if (!myPairing.participant_b_id) {
        // sit-out: this participant is paired with the host in the main room
        assignment = {
          pairingId: myPairing.id,
          roomName: null,
          roomLabel: myPairing.room_label || 'with the host',
          partnerName: 'the host',
          prompt: myPairing.rounds.prompt_text,
          secondsRemaining,
          isWithHost: true,
        };
      }
    }
  }

  let pairings = [];
  let pairingsHistory = [];
  if (isHostView) {
    const idToName = Object.fromEntries(participants.map((p) => [p.id, p.name]));

    // current round pairings (for the active "live pairings" view)
    if (session.status === 'running_round' || session.status === 'between_rounds') {
      const { data } = await admin
        .from('pairings')
        .select('id, room_name, room_label, participant_a_id, participant_b_id, rounds!inner(round_number)')
        .eq('session_id', session.id)
        .eq('rounds.round_number', session.current_round || 0);
      pairings = (data || []).map((p) => ({
        id: p.id,
        room_name: p.room_name,
        room_label: p.room_label,
        participant_a_name: idToName[p.participant_a_id],
        participant_b_name: p.participant_b_id ? idToName[p.participant_b_id] : null,
      }));
    }

    // full history across all rounds (for the round history panel)
    const { data: allPairings = [] } = await admin
      .from('pairings')
      .select('id, room_name, room_label, participant_a_id, participant_b_id, rounds!inner(round_number, prompt_text)')
      .eq('session_id', session.id);
    pairingsHistory = (allPairings || [])
      .map((p) => ({
        id: p.id,
        round_number: p.rounds?.round_number,
        prompt_text: p.rounds?.prompt_text,
        room_label: p.room_label,
        participant_a_name: idToName[p.participant_a_id],
        participant_b_name: p.participant_b_id ? idToName[p.participant_b_id] : null,
      }))
      .filter((p) => p.round_number != null)
      .sort((a, b) => a.round_number - b.round_number);
  }

  return NextResponse.json({
    session: {
      id: session.id,
      code: session.code,
      name: session.name,
      status: session.status,
      current_round: session.current_round,
      current_round_started_at: session.current_round_started_at,
      rounds_total: session.rounds_total,
      round_seconds: session.round_seconds,
      prompts: session.prompts,
      main_room_name: session.main_room_name,
    },
    participants,
    assignment,
    pairings,
    pairingsHistory,
    me: participantId ? { participantId } : null,
  });
}
