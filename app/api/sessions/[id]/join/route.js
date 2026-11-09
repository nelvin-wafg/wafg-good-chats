import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
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
import { isTrustedForProfile } from '@/lib/profile-trust';
import { REF_COOKIE, attributeJoin } from '@/lib/referral';
import { addSubscriberToKit } from '@/lib/kit';
import { signEmailVerifyToken } from '@/lib/email-verify-token';
import { sendVerificationEmail } from '@/lib/resend';
import { getApprovedHost } from '@/lib/auth';
import { joinWindow } from '@/lib/join-window';

// POST /api/sessions/:id/join
// body: { name, email, linkedinUrl?, newsletterOptIn }
// creates or updates the participant's profile (keyed by email), creates the
// session-specific participant row, sets HttpOnly cookies for both identity
// (8h) and profile recognition (6mo). syncs the email to Kit when opt-in is true.
export async function POST(request, { params }) {
  const allowed = await rateLimitByIp(request, 'join', { limit: 10, windowSeconds: 60 });
  if (!allowed) return new NextResponse('Too many join attempts · slow down for a minute', { status: 429 });

  let sessionId, name, email, linkedinUrl, newsletterOptIn, hostPreview = false;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    // an approved host can ask to get in early (to test the participant flow); it is only
    // honored below if the caller really is a logged-in approved host.
    hostPreview = body?.hostPreview === true;
    name = validateParticipantName(body?.name);
    email = validateEmail(body?.email);
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl);
    // default false: affirmative opt-in only, matching the consent model in
    // docs/SECURITY.md §13 ("unchecked by default"). the real join form always
    // sends an explicit boolean; this default only matters for malformed/forged
    // requests, where it should never silently subscribe someone.
    newsletterOptIn = validateBoolean(body?.newsletterOptIn ?? false, 'newsletterOptIn');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('Bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, status, metadata')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('Session not found', { status: 404 });
  if (session.status === 'ended') return new NextResponse('This session already ended', { status: 400 });

  // doors open 5 minutes before the published start time. before that nobody gets a
  // participant row or cookie, so nobody can end up stuck in a waiting room for an event
  // that is hours or days away. enforced HERE (not just in the page) so it can't be skipped.
  const win = joinWindow(session.metadata?.starts_at);
  if (win.gated && !win.open) {
    const hostOverride = hostPreview ? Boolean(await getApprovedHost()) : false;
    if (!hostOverride) {
      return NextResponse.json(
        {
          error: 'too_early',
          message: "This session isn't open yet · doors open 5 minutes before it starts",
          opensAt: new Date(win.opensAtMs).toISOString(),
          startsAt: new Date(win.startsAtMs).toISOString(),
          serverNow: Date.now(),
        },
        { status: 425 }
      );
    }
  }

  // waiting room semantics:
  // - status='live' (host has opened the room but rounds haven't started yet)
  //   → new arrivals land in the waiting room. they get a participant row, but
  //     metadata.admitted_at stays null until the host explicitly lets them in
  //     (or hits "kick it off", which auto-admits everyone via the round route).
  // - any other live state (running_round / closing) → auto-admit so latecomers
  //   slide straight into the main room.
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
    return new NextResponse('This session is full', { status: 403 });
  }

  // upsert profile by email
  const now = new Date().toISOString();
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, kit_synced_at, newsletter_opt_in')
    .eq('email', email)
    .maybeSingle();

  // typing an email proves nothing (the join form is open to everyone). an EXISTING profile may
  // only be edited, subscribed or handed its cookie when this browser already holds a cookie for
  // it: from a one-time sign-in link, or from having joined as that profile before. otherwise the
  // person still joins the session with the name they typed, but the stored profile is left
  // exactly as it was. see lib/profile-trust.js.
  const trusted = existingProfile ? isTrustedForProfile(cookies(), existingProfile.id) : false;
  // without proof, never let a typed checkbox subscribe someone: keep whatever consent they gave
  const effectiveOptIn = existingProfile && !trusted ? Boolean(existingProfile.newsletter_opt_in) : newsletterOptIn;

  let profileId;
  if (existingProfile) {
    profileId = existingProfile.id;
    if (trusted) {
      await admin
        .from('profiles')
        .update({
          display_name: name,
          linkedin_url: linkedinUrl,
          newsletter_opt_in: newsletterOptIn,
          updated_at: now,
        })
        .eq('id', profileId);
    }
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
      return new NextResponse('Could not create profile', { status: 500 });
    }
    profileId = created.id;

    // brand-new email · we don't know yet that this person actually owns it
    // (anyone can type any email into the join form). send a confirmation
    // link before we ever act on it — recap emails and the newsletter sync
    // are held until they click through (see /api/profiles/verify). the
    // session itself is never blocked on this; it only gates emailing them.
    const verifyToken = signEmailVerifyToken({ profileId, email });
    const verifyUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/profiles/verify?token=${verifyToken}`;
    sendVerificationEmail({ to: email, name, verifyUrl }).catch(() => {});
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
      .select('id, metadata, is_present, last_seen')
      .eq('session_id', session.id)
      .eq('profile_id', profileId)
      .order('joined_at', { ascending: false });
    if (existingRows && existingRows.length > 0) {
      // someone who only typed an existing member's email must not be able to take over that
      // member's live seat (rename them, hijack their pairing, undo a host removal). if the seat
      // is currently in use, an unproven caller is turned away; a legit person on a new device
      // can join as soon as the old tab has been gone for ~45 seconds, or sign in to prove it.
      if (existingProfile && !trusted) {
        const seen = existingRows[0].last_seen ? new Date(existingRows[0].last_seen).getTime() : 0;
        if (existingRows[0].is_present && Date.now() - seen < 45000) {
          return new NextResponse('That email is already in this session on another device · if that was you, close the other tab and try again in a minute', { status: 409 });
        }
      }
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
          kicked_at: null,
          metadata: { join_ip: getClientIp(request), admitted_at: preservedAdmittedAt },
        })
        .eq('id', primaryId)
        .select('id')
        .single();
      if (uErr) {
        console.error('participant reactivate error', uErr);
        return new NextResponse('Could not rejoin session', { status: 500 });
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
      return new NextResponse('Could not join session', { status: 500 });
    }
    participant = created;
  }

  // joined after arriving through someone's invite link: if this is their first call ever, the
  // inviter gets credit (best-effort, never blocks the join). see lib/referral.js.
  // (cookie from the link, or the email they signed up with after opening it, so a link opened on
  // a phone still counts when they join from a laptop)
  const refCode = cookies().get(REF_COOKIE)?.value || null;
  await attributeJoin(admin, { code: refCode, email, profileId, participantId: participant.id, sessionId: session.id });

  // sync to Kit if opted in (fire-and-forget; don't block the join on Kit availability).
  // only for existing (trusted) profiles — a brand-new email's sync is deferred
  // until they verify it (see /api/profiles/verify), so we never subscribe an
  // inbox nobody's confirmed ownership of.
  if (effectiveOptIn && existingProfile && !existingProfile.kit_synced_at) {
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
  const response = NextResponse.json({ participantId: participant.id });
  response.cookies.set(PARTICIPANT_COOKIE_NAME, participantToken, PARTICIPANT_COOKIE_OPTIONS);
  // the profile cookie (welcome-back + profile page) is only issued to a brand-new profile's
  // creator or to a caller who already proved they own the existing one. someone who merely
  // typed an existing email gets the session cookie only.
  if (!existingProfile || trusted) {
    response.cookies.set(PROFILE_COOKIE_NAME, signProfileToken({ profileId }), PROFILE_COOKIE_OPTIONS);
  }
  return response;
}
