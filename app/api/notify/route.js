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

  let email, firstName, linkedinUrl, source;
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
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('Bad request', { status: 400 });
  }

  // fire to Kit. if Kit isn't configured the helper returns { ok: false } and we
  // still tell the visitor we got them · they can sit in our memory until env
  // vars land, and we don't want to surface infra messiness to end users.
  const result = await addSubscriberToKit({
    email,
    firstName,
    linkedinUrl,
    sourceNote: source,
    tagId: process.env.KIT_NOTIFY_TAG_ID,
  });

  // log misconfiguration so it's visible in vercel logs without breaking UX
  if (!result.ok) {
    console.warn('[notify] kit subscribe not ok', result.reason);
  }

  return NextResponse.json({ ok: true });
}
