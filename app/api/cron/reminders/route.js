import { NextResponse } from 'next/server';
import { sendRsvpReminders } from '@/lib/notify';

export const dynamic = 'force-dynamic';
// emails are paced to stay under resend's rate limit
export const maxDuration = 60;

// GET /api/cron/reminders
// scheduled daily by vercel.json. emails ONE reminder to each person who saved a spot for a
// session that starts within about a day (see sendRsvpReminders in lib/notify.js).
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

  try {
    const result = await sendRsvpReminders();
    if (result.setupNeeded) console.warn('[cron/reminders] session_rsvps.reminder_sent_at is missing · run the one-time SQL');
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error('[cron/reminders] failed', e?.message || e);
    return new NextResponse('reminder run failed', { status: 500 });
  }
}
