import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { getProfileFromCookies } from '@/lib/profile-cookie';
import { getSignInFromCookies } from '@/lib/signin-cookie';
import { buildProfileHistory } from '@/lib/profile-history';
import { noShowRooms } from '@/lib/recap-partners';
import { rippleFor } from '@/lib/ripple';
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
  const cookieStore = cookies();
  const signedInCookie = getSignInFromCookies(cookieStore);
  const me = getProfileFromCookies(cookieStore) || signedInCookie;
  if (!me?.profileId) return new NextResponse('unauthorized', { status: 401 });

  // "signed in" = they clicked a one-time link sent to the profile's own inbox. the plain
  // profile cookie is handed out by the join form to anyone who types an email, with no proof
  // they own it, so it must NOT unlock anything that reveals who someone talked to.
  const signedIn = Boolean(signedInCookie && signedInCookie.profileId === me.profileId);

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

  let connectionsMade = 0;
  let history = [];
  let hist = { calls: 0, peopleMet: 0, sessions: [] };

  if (participantIds.length > 0) {
    const [{ data: pairings = [] }, { data: captures = [] }, { data: sessions = [] }, { data: rounds = [] }, { data: sessionParticipants = [] }, { data: waitEvents = [] }] = await Promise.all([
      admin.from('pairings')
        .select('round_id, participant_a_id, participant_b_id, room_name, room_label')
        .in('session_id', sessionIds),
      admin.from('captures')
        .select('capturer_id, captured_id, captured_linkedin_url, session_id')
        .in('capturer_id', participantIds),
      admin.from('sessions')
        .select('id, name, ended_at, created_at')
        .in('id', sessionIds),
      admin.from('rounds')
        .select('id, round_number')
        .in('session_id', sessionIds),
      admin.from('participants')
        .select('id, name, kicked_at, profile_id')
        .in('session_id', sessionIds),
      admin.from('connection_events')
        .select('payload')
        .in('session_id', sessionIds)
        .eq('event_type', 'partner-wait')
        .limit(5000),
    ]);

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

    // calls = real pairings that happened (no sit-outs, no-shows or removed partners), the
    // number behind ripple levels. the same rules as the recap email.
    hist = buildProfileHistory({
      myParticipants,
      sessions,
      pairings,
      rounds,
      participants: sessionParticipants,
      captures,
      noShows: noShowRooms(waitEvents),
    });
  }

  const ripple = rippleFor(hist.calls);

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
      goodChats: hist.calls,
      connectionsMade,
      eventsAttended: sessionIds.length,
      peopleMet: hist.peopleMet,
    },
    ripple: {
      count: ripple.count,
      level: ripple.level ? { name: ripple.level.name, emoji: ripple.level.emoji, calls: ripple.level.calls } : null,
      next: ripple.next ? { name: ripple.next.name, emoji: ripple.next.emoji, calls: ripple.next.calls } : null,
      toNext: ripple.toNext,
      progress: ripple.progress,
    },
    signedIn,
    // who they were paired with, per session · only for a signed-in (inbox-verified) browser
    people: signedIn ? hist.sessions : null,
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
