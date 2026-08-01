import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
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

  // host view requires any approved host (co-host enabled).
  if (isHostView) {
    const auth = await getApprovedHost();
    if (!auth) return new NextResponse('forbidden', { status: 403 });
  }

  // identify the calling participant (if any) from the cookie.
  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  const participantId = me?.participantId || null;

  // neither an approved host nor a verified participant of THIS session: withhold
  // everything except minimal public session status. without this, the roster
  // (names, linkedin urls, flags) and main_room_name leaked to any unauthenticated
  // caller — this is the shape the client already expects when `me` is null, so
  // the existing poll/redirect-to-rejoin logic in RoomExperience keeps working.
  if (!isHostView && !participantId) {
    return NextResponse.json({
      session: {
        id: session.id,
        code: session.code,
        name: session.name,
        status: session.status,
        current_round: session.current_round,
        rounds_total: session.rounds_total,
        round_seconds: session.round_seconds,
        prompts: session.prompts,
        is_published: session.metadata?.is_published === true,
        starts_at: session.metadata?.starts_at || null,
      },
      participants: [],
      assignment: null,
      pairings: [],
      pairingsHistory: [],
      directMessage: null,
      broadcast: null,
      me: null,
    });
  }

  // heartbeat: each poll from a participant marks them present + bumps last_seen.
  // this is what makes a browser refresh NOT look like a disconnect.
  if (participantId) {
    await admin
      .from('participants')
      .update({ is_present: true, last_seen: new Date().toISOString() })
      .eq('id', participantId)
      .eq('session_id', sessionId);
  }

  const { data: rawParticipants = [] } = await admin
    .from('participants')
    .select('id, name, is_present, current_room_name, joined_at, last_seen, metadata, profiles(linkedin_url)')
    .eq('session_id', session.id)
    .order('joined_at', { ascending: true });
  const participants = (rawParticipants || []).map((p) => ({
    id: p.id,
    name: p.name,
    is_present: p.is_present,
    current_room_name: p.current_room_name,
    joined_at: p.joined_at,
    last_seen: p.last_seen,
    linkedin_url: p.profiles?.linkedin_url || null,
    // flag_at + flag_text surfaced for host view · participant SOS taps land
    // here with the optional note they typed
    flag_at: p.metadata?.flag_at || null,
    flag_text: p.metadata?.flag_text || null,
    // admission state · null = still in waiting room. only meaningful while
    // session.status is 'live' or 'draft'; gets ignored once rounds start.
    admitted_at: p.metadata?.admitted_at || null,
  }));

  let assignment = null;
  if (participantId && session.status === 'running_round') {
    const { data: pairings = [] } = await admin
      .from('pairings')
      .select('id, participant_a_id, participant_b_id, room_name, room_label, round_id, rounds!inner(round_number, prompt_text, started_at)')
      .eq('session_id', session.id)
      .eq('rounds.round_number', session.current_round);

    const me = participants.find((p) => p.id === participantId);
    const myCurrentRoom = me?.current_room_name;

    function secondsRemainingFor(pairing) {
      const startedAt = new Date(pairing.rounds.started_at).getTime();
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      return Math.max(0, session.round_seconds - elapsed);
    }

    // PRIORITY 1: if the host PLACED us in a specific room (current_room_name),
    // honor that even if it's not our original pairing · we may have been moved
    // into another pair after our partner dropped or as a late-join slot-in.
    if (myCurrentRoom) {
      const placedPairing = pairings.find((p) => p.room_name === myCurrentRoom);
      if (placedPairing) {
        const otherIds = [placedPairing.participant_a_id, placedPairing.participant_b_id]
          .filter((id) => id && id !== participantId);
        const others = otherIds
          .map((id) => participants.find((p) => p.id === id))
          .filter(Boolean);
        const isOriginalMember =
          placedPairing.participant_a_id === participantId ||
          placedPairing.participant_b_id === participantId;
        assignment = {
          pairingId: placedPairing.id,
          roomName: placedPairing.room_name,
          roomLabel: placedPairing.room_label,
          partnerName: others.map((p) => p.name).join(' and ') || 'your match',
          partnerLinkedinUrl: others.length === 1 ? others[0]?.linkedin_url || null : null,
          prompt: placedPairing.rounds.prompt_text,
          secondsRemaining: secondsRemainingFor(placedPairing),
          isWithHost: false,
          isJoined: !isOriginalMember, // host dropped us into someone else's room
        };
      }
    }

    // PRIORITY 2: our own pairing for this round (the normal path)
    if (!assignment) {
      const myPairing = pairings.find(
        (p) => p.participant_a_id === participantId || p.participant_b_id === participantId
      );
      if (myPairing) {
        if (myPairing.room_name && myPairing.participant_b_id) {
          // standard pair room
          const partnerId = myPairing.participant_a_id === participantId
            ? myPairing.participant_b_id
            : myPairing.participant_a_id;
          const partner = participants.find((p) => p.id === partnerId);

          if (partner && !partner.is_present) {
            // ORPHANED · partner dropped mid-round. clear our room assignment so
            // we go back to main, and return an orphaned flag so the UI can show
            // a "your partner stepped away" banner. the host can drop us into
            // another room from the rail.
            if (me?.current_room_name) {
              await admin
                .from('participants')
                .update({ current_room_name: null })
                .eq('id', participantId);
            }
            assignment = {
              pairingId: myPairing.id,
              roomName: null,
              partnerName: partner.name || 'your partner',
              prompt: myPairing.rounds.prompt_text,
              secondsRemaining: secondsRemainingFor(myPairing),
              isWithHost: false,
              orphaned: true,
            };
          } else {
            assignment = {
              pairingId: myPairing.id,
              roomName: myPairing.room_name,
              roomLabel: myPairing.room_label,
              partnerName: partner?.name || 'your match',
              partnerLinkedinUrl: partner?.linkedin_url || null,
              prompt: myPairing.rounds.prompt_text,
              secondsRemaining: secondsRemainingFor(myPairing),
              isWithHost: false,
            };
          }
        } else if (!myPairing.participant_b_id) {
          // sit-out: this participant is paired with the host in the main room
          assignment = {
            pairingId: myPairing.id,
            roomName: null,
            roomLabel: myPairing.room_label || 'with the host',
            partnerName: 'the host',
            prompt: myPairing.rounds.prompt_text,
            secondsRemaining: secondsRemainingFor(myPairing),
            isWithHost: true,
          };
        }
      }
    }
  }

  // surface participant-facing extras for the caller: their own host-direct
  // message (if any) and the session-wide broadcast (if active within last 15s).
  let directMessage = null;
  let broadcast = null;
  if (participantId) {
    const meRow = rawParticipants.find((p) => p.id === participantId);
    const dm = meRow?.metadata?.host_message;
    if (dm?.text && dm?.at) {
      directMessage = { text: dm.text, at: dm.at };
    }
  }
  const sessionBroadcast = session?.metadata?.broadcast;
  if (sessionBroadcast?.text && sessionBroadcast?.at) {
    const ageMs = Date.now() - new Date(sessionBroadcast.at).getTime();
    if (ageMs >= 0 && ageMs < 15000) {
      broadcast = { text: sessionBroadcast.text, at: sessionBroadcast.at };
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
        participant_a_id: p.participant_a_id,
        participant_b_id: p.participant_b_id,
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
      // landing-page publish controls (lifted out of metadata for the wizard)
      is_published: session.metadata?.is_published === true,
      starts_at: session.metadata?.starts_at || null,
    },
    participants,
    assignment,
    pairings,
    pairingsHistory,
    directMessage,
    broadcast,
    me: participantId
      ? {
          participantId,
          // admitted=true if the session has moved past the waiting-room phase
          // OR if the host has explicitly let this participant in.
          admitted:
            !(session.status === 'live' || session.status === 'draft') ||
            Boolean(
              rawParticipants.find((p) => p.id === participantId)?.metadata?.admitted_at
            ),
        }
      : null,
  });
}
