import { NextResponse } from 'next/server';
import { addSubscriberToKit } from '@/lib/kit';
import { validateEmail, validateParticipantName, validateLinkedinUrl, ValidationError } from '@/lib/validate';
import { rateLimitByIp } from '@/lib/rate-limit';

// POST /api/notify
// body: { email, firstName, linkedinUrl?, source? }
// Public · no auth required. Used by the landing page's notify-list form.
// Sends the subscriber to Kit with the "good-chats-lead" tag so the host can
// segment notify-list folks from regular event opt-ins later. Rate-limited per
// IP so the form can't be hammered into Kit.
export async function POST(request) {
  const allowed = await rateLimitByIp(request, 'notify', { limit: 5, windowSeconds: 60 });
  if (!allowed) {
    return new NextResponse('Too many signups · try again in a minute', { status: 429 });
  }

  let email, firstName, linkedinUrl, source, subscribeToWeekly;
  try {
    const body = await request.json();
    email = validateEmail(body?.email);
    firstName = validateParticipantName(body?.firstName);
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl);
    if (!linkedinUrl) {
      return new NextResponse('LinkedIn is required', { status: 400 });
    }
    source = body?.source ? String(body.source).trim().slice(0, 500) : null;
    if (!source) source = null;
    subscribeToWeekly = body?.subscribeToWeekly === true;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('Bad request', { status: 400 });
  }

  // only push to Kit if they checked "add me to The Weekly"
  if (subscribeToWeekly) {
    const result = await addSubscriberToKit({
      email,
      firstName,
      linkedinUrl,
      sourceNote: source,
      tagId: process.env.KIT_NOTIFY_TAG_ID,
    });
    if (!result.ok) {
      console.warn('[notify] kit subscribe not ok', result.reason);
    }
  }

  // ping host via email · non-blocking, never surfaces errors to visitor
  const resendKey = process.env.RESEND_API_KEY;
  const notifyTo = process.env.NOTIFY_EMAIL;
  if (resendKey && notifyTo) {
    const linkedinLine = linkedinUrl ? `<br><a href="${linkedinUrl}">${linkedinUrl}</a>` : '';
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>',
        to: [notifyTo],
        subject: `✦ ${firstName} just signed up for Good Chats`,
        html: `<p><strong>${firstName}</strong> (${email}) signed up for Good Chats notifications.${linkedinLine}</p><p>${subscribeToWeekly ? '✓ opted in to The Weekly' : '✗ did not opt in to The Weekly'}</p>`,
      }),
    }).catch((e) => console.warn('[notify] host email failed', e?.message));
  }

  return NextResponse.json({ ok: true });
}
