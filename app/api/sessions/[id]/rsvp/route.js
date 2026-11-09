import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { joinWindow } from '@/lib/join-window';
import { sendRsvpConfirmationEmail } from '@/lib/resend';
import { REF_COOKIE, attributeInterest } from '@/lib/referral';
import { validateUuid, validateEmail, validateParticipantName, validateLinkedinUrl, ValidationError } from '@/lib/validate';

export const dynamic = 'force-dynamic';

// the most RSVPs one session will take. this is a public endpoint that sends an email, so
// it has a ceiling even if someone scripts it.
const MAX_RSVPS_PER_SESSION = 500;

// POST /api/sessions/:id/rsvp   body: { email, firstName?, linkedinUrl?, joinNotifyList? }
// public · "save my spot" on the "coming up" page, before the doors open. records the
// email for THIS session only, and sends a one-time confirmation. saving a spot is NOT
// consent to every future email, so it only joins the homepage notify list when the person
// ticks the separate, unticked-by-default box (joinNotifyList: true). the host's go-live
// email for this session includes everyone who saved a spot.
export async function POST(request, { params }) {
  // per-IP limit: a confirmation email goes out, so don't let this become a mail cannon
  const allowed = await rateLimitByIp(request, 'rsvp', { limit: 6, windowSeconds: 60 });
  if (!allowed) return new NextResponse('Too many tries · give it a minute', { status: 429 });

  let sessionId, email, firstName, linkedinUrl, joinNotifyList;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    email = validateEmail(body?.email);
    const rawName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
    firstName = rawName ? validateParticipantName(rawName) : null;
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl); // optional · null when blank
    joinNotifyList = body?.joinNotifyList === true;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('Bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, name, code, status, metadata')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('Session not found', { status: 404 });
  if (session.status === 'ended') return new NextResponse('This session already ended', { status: 400 });

  // only meaningful before the doors open; after that they should just join.
  const win = joinWindow(session.metadata?.starts_at);
  if (!win.gated || win.open) {
    return NextResponse.json({ error: 'open', message: "The doors are open · just join" }, { status: 409 });
  }

  const { count, error: countErr } = await admin
    .from('session_rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (countErr) return rsvpError(countErr);
  if ((count || 0) >= MAX_RSVPS_PER_SESSION) {
    return new NextResponse("This session's list is full", { status: 403 });
  }

  // insert-or-skip: saving the same email twice is fine and never sends a second email.
  const saveRow = (row) =>
    admin
      .from('session_rsvps')
      .upsert([row], { onConflict: 'session_id,email', ignoreDuplicates: true })
      .select('id');
  const baseRow = { session_id: sessionId, email, first_name: firstName };
  let { data: inserted, error } = await saveRow(linkedinUrl ? { ...baseRow, linkedin_url: linkedinUrl } : baseRow);
  // linkedin_url is a newer column: if its one-time SQL hasn't been run, save the spot without
  // it rather than failing the whole RSVP
  if (error && linkedinUrl && isMissingColumn(error)) {
    ({ data: inserted, error } = await saveRow(baseRow));
  }
  if (error) return rsvpError(error);

  // the optional "also tell me about future sessions" box. best-effort and independent of the
  // spot itself: it can never fail the RSVP.
  if (joinNotifyList) await joinHomepageList(admin, { email, firstName, linkedinUrl, sessionName: session.name });

  // saved a spot after arriving through someone's invite link: credit the inviter (best-effort)
  const refCode = cookies().get(REF_COOKIE)?.value;
  if (refCode) await attributeInterest(admin, { code: refCode, email, event: 'rsvp', sessionId });

  if ((inserted || []).length > 0) {
    // await it: a serverless function can be frozen once it replies. a failed email never
    // fails the RSVP itself (the spot is saved either way).
    const sent = await sendRsvpConfirmationEmail({
      to: email,
      firstName,
      sessionName: session.name,
      sessionCode: session.code,
      startsAt: session.metadata?.starts_at,
    });
    if (sent.ok) {
      await admin
        .from('session_rsvps')
        .update({ confirmation_sent_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .eq('email', email);
    }
  }

  // same answer whether or not the email was already on the list, so this can't be used
  // to find out who has saved a spot.
  return NextResponse.json({ ok: true });
}

// adds the person to the homepage notify list (what /api/notify does), unless that address is
// already on it. ticking the box is a deliberate fresh yes, so it also clears an earlier
// unsubscribe (same rule as the homepage form). their row is left un-emailed on purpose: the
// notify list's one announcement is for the NEXT session, which is what they asked to hear about.
async function joinHomepageList(admin, { email, firstName, linkedinUrl, sessionName }) {
  try {
    const { data: existing, error: lookupErr } = await admin
      .from('notify_signups')
      .select('id')
      .eq('email', email)
      .limit(1);
    if (lookupErr) throw lookupErr;
    if (!existing || existing.length === 0) {
      const { error } = await admin.from('notify_signups').insert({
        email,
        first_name: firstName,
        linkedin_url: linkedinUrl,
        source: `saved a spot · ${String(sessionName || '').slice(0, 120)}`,
        subscribed_to_weekly: false,
      });
      if (error) throw error;
    }
    await admin.from('email_unsubscribes').delete().eq('email', email);
  } catch (e) {
    console.warn('[rsvp] could not add to the notify list', e?.message || e);
  }
}

// 42703 = postgres "undefined column", PGRST204 = postgrest's "column not in schema cache"
function isMissingColumn(err) {
  return err?.code === '42703' || err?.code === 'PGRST204';
}

function rsvpError(err) {
  // 42P01 / PGRST205 = the session_rsvps table hasn't been created yet (one-time SQL)
  if (err?.code === '42P01' || err?.code === 'PGRST205') {
    return new NextResponse("Saving spots isn't switched on yet", { status: 503 });
  }
  console.error('[rsvp] failed', err?.message || err);
  return new NextResponse("Couldn't save your spot · try again", { status: 500 });
}
