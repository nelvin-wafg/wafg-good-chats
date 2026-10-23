import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { joinWindow } from '@/lib/join-window';
import { sendRsvpConfirmationEmail } from '@/lib/resend';
import { validateUuid, validateEmail, validateParticipantName, ValidationError } from '@/lib/validate';

export const dynamic = 'force-dynamic';

// the most RSVPs one session will take. this is a public endpoint that sends an email, so
// it has a ceiling even if someone scripts it.
const MAX_RSVPS_PER_SESSION = 500;

// POST /api/sessions/:id/rsvp   body: { email, firstName? }
// public · "save my spot" on the "coming up" page, before the doors open. records the
// email for THIS session only, and sends a one-time confirmation. it never adds anyone to
// the homepage notify list (saving a spot for one session isn't consent to every future
// email). the host's go-live email for this session includes everyone who saved a spot.
export async function POST(request, { params }) {
  // per-IP limit: a confirmation email goes out, so don't let this become a mail cannon
  const allowed = await rateLimitByIp(request, 'rsvp', { limit: 6, windowSeconds: 60 });
  if (!allowed) return new NextResponse('too many tries · give it a minute', { status: 429 });

  let sessionId, email, firstName;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    email = validateEmail(body?.email);
    const rawName = typeof body?.firstName === 'string' ? body.firstName.trim() : '';
    firstName = rawName ? validateParticipantName(rawName) : null;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, name, code, status, metadata')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });
  if (session.status === 'ended') return new NextResponse('this session already ended', { status: 400 });

  // only meaningful before the doors open; after that they should just join.
  const win = joinWindow(session.metadata?.starts_at);
  if (!win.gated || win.open) {
    return NextResponse.json({ error: 'open', message: "the doors are open · just join" }, { status: 409 });
  }

  const { count, error: countErr } = await admin
    .from('session_rsvps')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (countErr) return rsvpError(countErr);
  if ((count || 0) >= MAX_RSVPS_PER_SESSION) {
    return new NextResponse("this session's list is full", { status: 403 });
  }

  // insert-or-skip: saving the same email twice is fine and never sends a second email.
  const { data: inserted, error } = await admin
    .from('session_rsvps')
    .upsert([{ session_id: sessionId, email, first_name: firstName }], { onConflict: 'session_id,email', ignoreDuplicates: true })
    .select('id');
  if (error) return rsvpError(error);

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

function rsvpError(err) {
  // 42P01 / PGRST205 = the session_rsvps table hasn't been created yet (one-time SQL)
  if (err?.code === '42P01' || err?.code === 'PGRST205') {
    return new NextResponse("saving spots isn't switched on yet", { status: 503 });
  }
  console.error('[rsvp] failed', err?.message || err);
  return new NextResponse("couldn't save your spot · try again", { status: 500 });
}
