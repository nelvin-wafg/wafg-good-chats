import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createMeetingToken, roomUrl } from '@/lib/daily';
import { adminClient, createClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { rateLimitByIp } from '@/lib/rate-limit';

// POST /api/daily/token  body: { roomName, userName, isOwner? }
// returns: { token, url }
//
// authorization rules:
//   isOwner=true  → must be the authenticated approved host who owns the session
//                   that this room belongs to.
//   isOwner=false → must have a valid participant cookie for the session.
//                   for pair rooms, must be one of the two participants in the pairing.
//                   for main room, any joined participant of that session is allowed.
//
// rate-limited per IP to prevent token-grinding attacks (50 / 5 min).
export async function POST(request) {
  // light rate limit · token grinding is the abuse pattern we're defending against
  const ok = await rateLimitByIp(request, 'daily-token', { limit: 50, windowSeconds: 300 });
  if (!ok) return new NextResponse('too many token requests', { status: 429 });

  let body;
  try {
    body = await request.json();
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }
  const { roomName, userName } = body || {};
  const isOwner = Boolean(body?.isOwner);

  if (!roomName || typeof roomName !== 'string' || roomName.length > 100) {
    return new NextResponse('roomName required', { status: 400 });
  }
  if (!userName || typeof userName !== 'string' || userName.length > 64) {
    return new NextResponse('userName required', { status: 400 });
  }

  const admin = adminClient();

  // figure out which session this room belongs to and whether it's a main or pair room
  let sessionRow = null;
  let pairingForRoom = null;

  // try main room match
  const { data: mainSession } = await admin
    .from('sessions')
    .select('id, host_id, main_room_name, status')
    .eq('main_room_name', roomName)
    .maybeSingle();

  if (mainSession) {
    sessionRow = mainSession;
  } else {
    // try pair room match (with the parent session info)
    const { data: pairing } = await admin
      .from('pairings')
      .select('id, session_id, participant_a_id, participant_b_id, sessions!inner(id, host_id, main_room_name, status)')
      .eq('room_name', roomName)
      .maybeSingle();
    if (pairing) {
      sessionRow = pairing.sessions;
      pairingForRoom = pairing;
    }
  }

  if (!sessionRow) return new NextResponse('room not found', { status: 404 });
  if (sessionRow.status === 'ended') return new NextResponse('session has ended', { status: 410 });

  // auth check
  let resolvedUserName = userName;
  if (isOwner) {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new NextResponse('not authenticated', { status: 401 });

    const { data: host } = await admin
      .from('hosts')
      .select('is_approved, display_name')
      .eq('id', user.id)
      .maybeSingle();
    if (!host?.is_approved) return new NextResponse('host not approved', { status: 403 });

    // any approved host can request an owner token (co-host enabled).

    // override the userName with the host's actual display name so participants see "Nelvin"
    if (host.display_name) {
      resolvedUserName = host.display_name;
    }
  } else {
    // participant flow
    const cookieStore = cookies();
    const me = getParticipantFromCookies(cookieStore, sessionRow.id);
    if (!me) return new NextResponse('not joined as a participant', { status: 401 });

    if (pairingForRoom) {
      // for pair rooms, only the two participants in that pairing can get a token
      if (
        pairingForRoom.participant_a_id !== me.participantId &&
        pairingForRoom.participant_b_id !== me.participantId
      ) {
        return new NextResponse('not in this pairing', { status: 403 });
      }
    }
    // for main room: any verified participant of this session is allowed.
  }

  try {
    const token = await createMeetingToken({
      roomName,
      userName: (resolvedUserName || userName).slice(0, 64),
      isOwner,
      expMinutes: 30,
    });
    return NextResponse.json({ token, url: roomUrl(roomName) });
  } catch (e) {
    return new NextResponse('could not generate token', { status: 500 });
  }
}
