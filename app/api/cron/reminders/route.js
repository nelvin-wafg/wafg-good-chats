import { NextResponse } from 'next/server';
import { sendRsvpReminders } from '@/lib/notify';
import { sendFollowUps } from '@/lib/followup';

export const dynamic = 'force-dynamic';
// emails are paced to stay under resend's rate limit
export const maxDuration = 60;

// GET /api/cron/reminders
// scheduled daily by vercel.json. emails ONE reminder to each person who saved a spot for a
// session that starts within about a day (see sendRsvpReminders in lib/notify.js), and the
// day-after follow-up to people from a call that ended about a day ago (lib/followup.js).
//
// protected by CRON_SECRET exactly like /api/cron/cleanup: vercel cron sends
// Authorization: Bearer <CRON_SECRET>, and with the var unset this refuses every request
// rather than becoming a public "email everyone" endpoint.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/reminders] CRON_SECRET is not set · refusing all requests');
    return new NextResponse('cron not configured', { status: 503 });
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('unauthorized', { status: 401 });
  }
  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ ok: false, reason: 'RESEND_API_KEY not set' });
  }

  const startedAt = Date.now();
  let result = null;
  let reminderError = null;
  try {
    result = await sendRsvpReminders();
    if (result.setupNeeded) console.warn('[cron/reminders] session_rsvps.reminder_sent_at is missing · run the one-time SQL');
  } catch (e) {
    reminderError = e;
    console.error('[cron/reminders] failed', e?.message || e);
  }

  // the day-after "who do you want to talk to again?" emails ride along on this same daily job
  // (the free hosting plan has no room for another scheduled job). a failure here never affects
  // the reminders above, and it stops starting new batches shortly before the function's time limit.
  let followUps = null;
  try {
    followUps = await sendFollowUps({ deadline: startedAt + 48000 });
    if (followUps.setupNeeded) console.warn('[cron/reminders] participants.followup_sent_at is missing · run the one-time SQL');
  } catch (e) {
    console.error('[cron/followups] failed', e?.message || e);
    followUps = { ok: false };
  }

  if (reminderError && !followUps?.sent) return new NextResponse('reminder run failed', { status: 500 });
  return NextResponse.json({ ok: !reminderError, ...(result || {}), followUps });
}
