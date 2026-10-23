import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { logAuditEvent } from '@/lib/audit';
import { goLiveStatus, sendGoLive, isMissingNotificationsTable } from '@/lib/notify';
import { sendGoingLiveEmail } from '@/lib/resend';
import { validateUuid, ValidationError } from '@/lib/validate';

export const dynamic = 'force-dynamic';
// sending is paced to stay under resend's rate limit, so a full run takes ~30-50s.
export const maxDuration = 60;

// the "we're live" email goes to homepage signups who have NEVER joined a session
// (people who already come to Good Chats don't need an invitation each time), and
// only when the host presses "send now". nothing ever sends this automatically.

async function loadSession(admin, id) {
  const { data } = await admin
    .from('sessions')
    .select('id, name, code, status')
    .eq('id', id)
    .maybeSingle();
  return data || null;
}

// GET /api/sessions/:id/notify-live
// host-only · how many people the button would email right now.
export async function GET(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const session = await loadSession(admin, sessionId);
  if (!session) return new NextResponse('not found', { status: 404 });

  try {
    const st = await goLiveStatus(admin, sessionId);
    return NextResponse.json({
      eligible: st.eligible.length,
      eligibleRsvps: st.eligibleRsvps,
      eligibleHomepage: st.eligibleHomepage,
      alreadySent: st.alreadySent,
      failed: st.failedCount,
      configured: Boolean(process.env.RESEND_API_KEY),
    });
  } catch (e) {
    // the one-time SQL (session_notifications) hasn't been run yet
    if (isMissingNotificationsTable(e)) return NextResponse.json({ setupNeeded: true });
    console.error('[notify-live] status failed', e?.message || e);
    return new NextResponse('could not check the list', { status: 500 });
  }
}

// POST /api/sessions/:id/notify-live   body: { expected: <count the host confirmed> }
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, expected, isTest;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json().catch(() => ({}));
    expected = Number.isInteger(body?.expected) && body.expected >= 0 ? body.expected : undefined;
    isTest = body?.test === true;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }
  // the host must have seen and confirmed a count; refuse blind sends.
  if (!isTest && expected === undefined) return new NextResponse('confirm the count first', { status: 400 });

  const admin = adminClient();
  const session = await loadSession(admin, sessionId);
  if (!session) return new NextResponse('not found', { status: 404 });

  // "send me a test": one email, to the host's OWN address only, so they can see exactly
  // what subscribers will get before pressing the real button. not logged, never counts
  // against anyone, and works any time the session exists.
  if (isTest) {
    if (!process.env.RESEND_API_KEY) {
      return new NextResponse('email is not set up on the server (RESEND_API_KEY)', { status: 503 });
    }
    const to = auth.host.email;
    if (!to) return new NextResponse('no email address on your host account', { status: 400 });
    const r = await sendGoingLiveEmail({
      to,
      firstName: String(auth.host.display_name || 'friend').split(' ')[0],
      sessionName: session.name,
      sessionCode: session.code,
    });
    if (!r.ok) return new NextResponse(`test email failed (${r.reason || 'unknown'})`, { status: 502 });
    return NextResponse.json({ ok: true, sentTo: to });
  }
  if (session.status !== 'live' && session.status !== 'running_round') {
    return new NextResponse('go live first, then send', { status: 409 });
  }
  if (!process.env.RESEND_API_KEY) {
    return new NextResponse('email is not set up on the server (RESEND_API_KEY)', { status: 503 });
  }

  try {
    const result = await sendGoLive(admin, session, { expected });
    if (result.mismatch) {
      return NextResponse.json({ mismatch: true, eligible: result.eligible }, { status: 409 });
    }
    logAuditEvent({
      eventType: 'session.go_live_email',
      actorId: auth.user.id,
      actorLabel: auth.host.display_name || auth.host.email,
      sessionId: session.id,
      metadata: { attempted: result.attempted, sent: result.sent, failed: result.failed, remaining: result.remaining },
    });
    return NextResponse.json(result);
  } catch (e) {
    if (isMissingNotificationsTable(e)) {
      return new NextResponse('one-time setup needed: the email log table has not been created yet', { status: 503 });
    }
    console.error('[notify-live] send failed', e?.message || e);
    return new NextResponse('could not send · nothing was emailed twice, safe to try again', { status: 500 });
  }
}
