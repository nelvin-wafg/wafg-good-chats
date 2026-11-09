import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { deleteRoom } from '@/lib/daily';
import { sendRecapEmail } from '@/lib/resend';
import { logAuditEvent } from '@/lib/audit';
import { buildPartnerLists, noShowRooms } from '@/lib/recap-partners';
import { createLoginTokens, loginUrl, RECAP_LINK_TTL_MS } from '@/lib/login-link';
import { trackedLinkUrl } from '@/lib/track-link';
import { ensureInviteCodes } from '@/lib/referral';

const SITE = 'https://goodchats.weareforgood.com';

// POST /api/sessions/:id/end  — any approved host ends the session
export async function POST(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('Not an approved host', { status: 403 });

  const admin = adminClient();
  const { data: session } = await admin.from('sessions').select('*').eq('id', params.id).single();
  if (!session) return new NextResponse('Session not found', { status: 404 });

  // tear down all daily rooms (main + any active pair rooms)
  const { data: pairings = [] } = await admin.from('pairings').select('room_name').eq('session_id', session.id);
  const cleanupPromises = pairings.filter((p) => p.room_name).map((p) => deleteRoom(p.room_name).catch(() => {}));
  if (session.main_room_name) cleanupPromises.push(deleteRoom(session.main_room_name).catch(() => {}));
  await Promise.all(cleanupPromises);

  await admin
    .from('participants')
    .update({ current_room_name: null, is_present: false, left_at: new Date().toISOString() })
    .eq('session_id', session.id);

  await admin
    .from('sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', session.id);

  logAuditEvent({
    eventType: 'session.ended',
    actorId: auth.user.id,
    actorLabel: auth.host.display_name || auth.host.email,
    sessionId: session.id,
  });

  // fire recap emails to all participants who have a profile email · non-blocking
  try {
    const [{ data: participants }, { data: captures }, { data: rounds }, { data: pairingRows }, { data: waitEvents }] = await Promise.all([
      admin.from('participants')
        .select('id, name, kicked_at, profile_id, profiles(email, email_verified_at)')
        .eq('session_id', session.id),
      admin.from('captures')
        .select('capturer_id, captured_id, captured_name, captured_linkedin_url')
        .eq('session_id', session.id),
      admin.from('rounds')
        .select('id, round_number, prompt_text')
        .eq('session_id', session.id)
        .order('round_number', { ascending: true }),
      // the pairings (who sat with whom) and the "waiting for partner" log, so the recap can
      // list everyone each person was paired with. both are best-effort: if either query fails
      // the email just goes out without the "everyone you were paired with" section.
      admin.from('pairings')
        .select('round_id, participant_a_id, participant_b_id, room_name, room_label')
        .eq('session_id', session.id),
      admin.from('connection_events')
        .select('payload')
        .eq('session_id', session.id)
        .eq('event_type', 'partner-wait')
        .limit(1000),
    ]);

    const partnersByParticipant = buildPartnerLists({
      pairings: pairingRows || [],
      rounds: rounds || [],
      participants: participants || [],
      captures: captures || [],
      noShows: noShowRooms(waitEvents || []),
    });

    const capturesByParticipant = (captures || []).reduce((acc, c) => {
      if (!acc[c.capturer_id]) acc[c.capturer_id] = [];
      acc[c.capturer_id].push({ captured_name: c.captured_name, captured_linkedin_url: c.captured_linkedin_url });
      return acc;
    }, {});

    // only email participants whose profile email is verified — either a
    // brand-new email that's been confirmed via /api/profiles/verify, or a
    // pre-existing profile grandfathered in as trusted (see schema.sql).
    const recipients = (participants || []).filter((p) => p.profiles?.email && p.profiles?.email_verified_at);

    // each recap's "see your history" button is a one-time sign-in link to that person's
    // profile. best-effort: if the tokens can't be made (e.g. the login_tokens SQL hasn't been
    // run yet) the button falls back to the plain /profile page and the recap still goes out.
    const links = await createLoginTokens(admin, recipients.map((p) => p.profile_id), RECAP_LINK_TTL_MS);

    // each person's personal invite link for the "know someone who'd love this?" line (best-effort)
    const inviteCodes = await ensureInviteCodes(admin, recipients.map((p) => p.profile_id));

    const emailPromises = recipients
      .map((p) => sendRecapEmail({
        inviteUrl: inviteCodes[p.profile_id] ? `${SITE}/i/${inviteCodes[p.profile_id]}` : null,
        historyUrl: links.tokens[p.profile_id] ? loginUrl(links.tokens[p.profile_id]) : null,
        to: p.profiles.email,
        participantName: p.name,
        sessionName: session.name,
        // LinkedIn buttons go through /go/<token> so we can count who actually uses them
        captures: (capturesByParticipant[p.id] || []).map((c) => ({
          ...c,
          captured_linkedin_url: c.captured_linkedin_url
            ? trackedLinkUrl({ url: c.captured_linkedin_url, kind: 'recap-linkedin', profileId: p.profile_id, sessionId: session.id })
            : c.captured_linkedin_url,
        })),
        prompts: rounds || [],
        partners: partnersByParticipant[p.id] || [],
      }).catch((e) => console.error('[end] recap email failed for participant', p.id, e?.message)));

    // don't await — let emails send in the background so the host isn't blocked
    Promise.all(emailPromises).catch(() => {});
  } catch (e) {
    // recap email errors must never block the session end response
    console.error('[end] recap email batch error', e?.message || e);
  }

  return NextResponse.json({ ok: true });
}
