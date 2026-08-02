import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { getProfileFromCookies } from '@/lib/profile-cookie';
import { rateLimitByIp } from '@/lib/rate-limit';
import {
  validateParticipantName,
  validateLinkedinUrl,
  validateUuid,
  ValidationError,
} from '@/lib/validate';

// GET /api/profiles/me
// standalone "my profile" page data · authenticated by the 6-month profile
// cookie (not a session-scoped participant cookie, since this is meant to be
// visited anytime, not just during a live session).
// returns profile fields + private stats + private history. never exposed to
// anyone but the profile owner — no public leaderboard, per design.
export async function GET() {
  const me = getProfileFromCookies(cookies());
  if (!me?.profileId) return new NextResponse('unauthorized', { status: 401 });

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, display_name, linkedin_url, avatar_url, newsletter_opt_in, created_at')
    .eq('id', me.profileId)
    .maybeSingle();
  if (!profile) return new NextResponse('profile not found', { status: 404 });

  // every participant row this profile has ever had, across every session
  const { data: myParticipants = [] } = await admin
    .from('participants')
    .select('id, session_id')
    .eq('profile_id', profile.id);
  const participantIds = myParticipants.map((p) => p.id);
  const sessionIds = [...new Set(myParticipants.map((p) => p.session_id))];

  let goodChats = 0;
  let connectionsMade = 0;
  let history = [];

  if (participantIds.length > 0) {
    const [{ data: pairings = [] }, { data: captures = [] }, { data: sessions = [] }] = await Promise.all([
      admin.from('pairings')
        .select('id, participant_a_id, participant_b_id')
        .or(`participant_a_id.in.(${participantIds.join(',')}),participant_b_id.in.(${participantIds.join(',')})`),
      admin.from('captures')
        .select('id, capturer_id, session_id')
        .in('capturer_id', participantIds),
      admin.from('sessions')
        .select('id, name, ended_at, created_at')
        .in('id', sessionIds),
    ]);

    goodChats = pairings.length;
    connectionsMade = captures.length;

    const capturesBySession = captures.reduce((acc, c) => {
      acc[c.session_id] = (acc[c.session_id] || 0) + 1;
      return acc;
    }, {});

    history = sessions
      .map((s) => ({
        sessionId: s.id,
        sessionName: s.name,
        date: s.ended_at || s.created_at,
        capturedCount: capturesBySession[s.id] || 0,
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));
  }

  return NextResponse.json({
    profile: {
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      linkedinUrl: profile.linkedin_url,
      avatarUrl: profile.avatar_url,
      newsletterOptIn: profile.newsletter_opt_in,
      createdAt: profile.created_at,
    },
    stats: {
      goodChats,
      connectionsMade,
      eventsAttended: sessionIds.length,
    },
    history,
  });
}

// PATCH /api/profiles/me  body: { sessionId?, name, linkedinUrl }
// two auth paths depending on where this is called from:
//  - WITH sessionId: in-session "edit info" modal · authenticated by the
//    participant identity cookie (sessionId + participantId), and also
//    updates the current session's participant row so pairings/lists reflect
//    the change immediately.
//  - WITHOUT sessionId: standalone "my profile" page edit · authenticated by
//    the 6-month profile cookie instead. no live session to sync a name into.
export async function PATCH(request) {
  const allowed = await rateLimitByIp(request, 'profiles-me', { limit: 10, windowSeconds: 300 });
  if (!allowed) return new NextResponse('too many requests', { status: 429 });

  let sessionId, name, linkedinUrl;
  try {
    const body = await request.json();
    sessionId = body?.sessionId ? validateUuid(body.sessionId, 'session id') : null;
    name = validateParticipantName(body?.name);
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const cookieStore = cookies();
  const admin = adminClient();
  const now = new Date().toISOString();

  if (sessionId) {
    const me = getParticipantFromCookies(cookieStore, sessionId);
    if (!me?.participantId) return new NextResponse('unauthorized', { status: 401 });

    const { data: participant } = await admin
      .from('participants')
      .select('id, profile_id')
      .eq('id', me.participantId)
      .eq('session_id', sessionId)
      .maybeSingle();
    if (!participant) return new NextResponse('participant not found', { status: 404 });

    if (participant.profile_id) {
      await admin
        .from('profiles')
        .update({ display_name: name, linkedin_url: linkedinUrl, updated_at: now })
        .eq('id', participant.profile_id);
    }
    // update the per-session participant row so the current session reflects it
    await admin.from('participants').update({ name }).eq('id', participant.id);
    return NextResponse.json({ ok: true, name, linkedinUrl });
  }

  // standalone edit · profile cookie auth
  const me = getProfileFromCookies(cookieStore);
  if (!me?.profileId) return new NextResponse('unauthorized', { status: 401 });
  const { error } = await admin
    .from('profiles')
    .update({ display_name: name, linkedin_url: linkedinUrl, updated_at: now })
    .eq('id', me.profileId);
  if (error) return new NextResponse('could not update profile', { status: 500 });
  return NextResponse.json({ ok: true, name, linkedinUrl });
}
