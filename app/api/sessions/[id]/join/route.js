import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import {
  validateParticipantName,
  validateUuid,
  validateEmail,
  validateLinkedinUrl,
  validateBoolean,
  ValidationError,
} from '@/lib/validate';
import { rateLimitByIp, getClientIp } from '@/lib/rate-limit';
import {
  signParticipantToken,
  PARTICIPANT_COOKIE_NAME,
  PARTICIPANT_COOKIE_OPTIONS,
} from '@/lib/participant-token';
import {
  signProfileToken,
  PROFILE_COOKIE_NAME,
  PROFILE_COOKIE_OPTIONS,
} from '@/lib/profile-cookie';
import { addSubscriberToKit } from '@/lib/kit';

// POST /api/sessions/:id/join
// body: { name, email, linkedinUrl?, newsletterOptIn }
// creates or updates the participant's profile (keyed by email), creates the
// session-specific participant row, sets HttpOnly cookies for both identity
// (8h) and profile recognition (6mo). syncs the email to Kit when opt-in is true.
export async function POST(request, { params }) {
  const allowed = await rateLimitByIp(request, 'join', { limit: 10, windowSeconds: 60 });
  if (!allowed) return new NextResponse('too many join attempts · slow down for a minute', { status: 429 });

  let sessionId, name, email, linkedinUrl, newsletterOptIn;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    name = validateParticipantName(body?.name);
    email = validateEmail(body?.email);
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl);
    newsletterOptIn = validateBoolean(body?.newsletterOptIn ?? true, 'newsletterOptIn');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });
  if (session.status === 'ended') return new NextResponse('this session already ended', { status: 400 });

  // waiting room semantics:
  // - status='live' (host has opened the room but rounds haven't started yet)
  //   → new arrivals land in the waiting room. they get a participant row, but
  //     metadata.admitted_at stays null until the host explicitly lets them in
  //     (or hits "kick it off", which auto-admits everyone via the round route).
  // - any other live state (running_round / between_rounds / closing) → auto-admit
  //   so latecomers slide straight into the main room.
  // - status='draft' is rare here (the link normally isn't shared yet) · treat
  //   like 'live' to be safe: join, sit in waiting until the host opens up.
  const needsAdmission = session.status === 'live' || session.status === 'draft';
  const admissionStamp = needsAdmission ? null : new Date().toISOString();

  // session capacity check
  const { count } = await admin
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if ((count || 0) >= 60) {
    return new NextResponse('this session is full', { status: 403 });
  }

  // upsert profile by email
  const now = new Date().toISOString();
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, kit_synced_at')
    .eq('email', email)
    .maybeSingle();

  let profileId;
  if (existingProfile) {
    profileId = existingProfile.id;
    await admin
      .from('profiles')
      .update({
        display_name: name,
        linkedin_url: linkedinUrl,
        newsletter_opt_in: newsletterOptIn,
        updated_at: now,
      })
      .eq('id', profileId);
  } else {
    const { data: created, error: createErr } = await admin
      .from('profiles')
      .insert({
        email,
        display_name: name,
        linkedin_url: linkedinUrl,
        newsletter_opt_in: newsletterOptIn,
      })
      .select('id')
      .single();
    if (createErr) {
      console.error('profile create error', createErr);
      return new NextResponse('could not create profile', { status: 500 });
    }
    profileId = created.id;
  }

  // create OR reuse the session-specific participant row.
  // if the same profile already has a row in this session (because they
  // disconnected and rejoined, or the host kicked them and they came back),
  // reactivate that row instead of inserting a duplicate · otherwise they'd
  // show twice in every list and their captures would get split across two
  // identities. any older duplicate rows from before this fix are marked absent.
  let participant = null;
  if (profileId) {
    const { data: existingRows } = await admin
      .from('participants')
      .select('id, metadata')
      .eq('session_id', session.id)
      .eq('profile_id', profileId)
      .order('joined_at', { ascending: false });
    if (existingRows && existingRows.length > 0) {
      const primaryId = existingRows[0].id;
      const prevMeta = existingRows[0].metadata || {};
      // returning user: if they were already admitted earlier in this session,
      // keep that admission (don't re-bench them just because they refreshed).
      const preservedAdmittedAt = prevMeta.admitted_at || admissionStamp;
      const { data: updated, error: uErr } = await admin
        .from('participants')
        .update({
          name,
          is_present: true,
          last_seen: now,
          left_at: null,
          metadata: { join_ip: getClientIp(request), admitted_at: preservedAdmittedAt },
        })
        .eq('id', primaryId)
        .select('id')
        .single();
      if (uErr) {
        console.error('participant reactivate error', uErr);
        return new NextResponse('could not rejoin session', { status: 500 });
      }
      participant = updated;
      // legacy: mark any older duplicate rows for this profile as absent so
      // they stop appearing in "in main room" / pairings / counts.
      const oldDupes = existingRows.slice(1).map((r) => r.id);
      if (oldDupes.length > 0) {
        await admin
          .from('participants')
          .update({ is_present: false, current_room_name: null })
          .in('id', oldDupes);
      }
    }
  }
  if (!participant) {
    const { data: created, error: pErr } = await admin
      .from('participants')
      .insert({
        session_id: session.id,
        profile_id: profileId,
        name,
        is_present: true,
        metadata: { join_ip: getClientIp(request), admitted_at: admissionStamp },
      })
      .select('id')
      .single();
    if (pErr) {
      console.error('participant create error', pErr);
      return new NextResponse('could not join session', { status: 500 });
    }
    participant = created;
  }

  // sync to Kit if opted in (fire-and-forget; don't block the join on Kit availability)
  if (newsletterOptIn && (!existingProfile || !existingProfile.kit_synced_at)) {
    addSubscriberToKit({ email, firstName: name.split(' ')[0], linkedinUrl })
      .then(async (r) => {
        if (r.ok) {
          await admin.from('profiles').update({ kit_synced_at: now }).eq('id', profileId);
        }
      })
      .catch(() => {});
  }

  // sign cookies and respond
  const participantToken = signParticipantToken({ sessionId: session.id, participantId: participant.id });
  const profileToken = signProfileToken({ profileId });
  const response = NextResponse.json({ participantId: participant.id });
  response.cookies.set(PARTICIPANT_COOKIE_NAME, participantToken, PARTICIPANT_COOKIE_OPTIONS);
  response.cookies.set(PROFILE_COOKIE_NAME, profileToken, PROFILE_COOKIE_OPTIONS);
  return response;
}
