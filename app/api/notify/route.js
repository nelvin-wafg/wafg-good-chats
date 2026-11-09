import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { addSubscriberToKit } from '@/lib/kit';
import { validateEmail, validateParticipantName, validateLinkedinUrl, ValidationError } from '@/lib/validate';
import { rateLimitByIp, checkRateLimit } from '@/lib/rate-limit';
import { createHash } from 'crypto';
import { adminClient } from '@/lib/supabase-server';
import { escHtml, sendInviteWelcomeEmail } from '@/lib/resend';
import { REF_COOKIE, attributeInterest, findInviter } from '@/lib/referral';

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
    // the homepage form requires LinkedIn; a friend's invite page asks for the least it can
    // (requireLinkedin: false), since that's the moment someone is most likely to bounce
    if (!linkedinUrl && body?.requireLinkedin !== false) {
      return new NextResponse('LinkedIn is required', { status: 400 });
    }
    source = body?.source ? String(body.source).trim().slice(0, 500) : null;
    if (!source) source = null;
    subscribeToWeekly = body?.subscribeToWeekly === true;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('Bad request', { status: 400 });
  }

  // always save to supabase regardless of Kit opt-in
  try {
    const admin = adminClient();
    await admin.from('notify_signups').insert({
      email,
      first_name: firstName,
      linkedin_url: linkedinUrl,
      source,
      subscribed_to_weekly: subscribeToWeekly,
    });
  } catch (e) {
    console.warn('[notify] supabase insert failed', e?.message);
  }

  // remember whether this address had unsubscribed BEFORE we clear it below: the welcome email
  // must never go to someone who opted out, even if a sign-up with their address just re-added them
  let wasUnsubscribed = false;
  try {
    const { data: u } = await adminClient().from('email_unsubscribes').select('email').eq('email', email).limit(1);
    wasUnsubscribed = Boolean(u && u.length);
  } catch {}

  // signing up here again is a deliberate fresh yes: clear an earlier unsubscribe so they
  // actually get the announcements they just asked for. best-effort.
  try {
    await adminClient().from('email_unsubscribes').delete().eq('email', email);
  } catch {}

  // signed up after arriving through someone's invite link: credit the inviter (best-effort)
  try {
    const refCode = cookies().get(REF_COOKIE)?.value;
    if (refCode) await attributeInterest(adminClient(), { code: refCode, email, event: 'signup' });
  } catch {}

  // signed up on a friend's invite page: send ONE short "you're on the list" email naming who
  // invited them, so they aren't left wondering. an unauthenticated form that emails whatever
  // address is typed could be used to pester someone, so: invite sign-ups only, at most one per
  // address per day, never to an address that unsubscribed, and it carries an unsubscribe link.
  if (typeof source === 'string' && source.startsWith('invite from')) {
    try {
      const admin = adminClient();
      const bucket = `invite-welcome:${createHash('sha256').update(email).digest('hex').slice(0, 32)}`;
      const { ok: underLimit } = await checkRateLimit(bucket, 1, 3600);
      if (underLimit && !wasUnsubscribed) {
        const refCode = cookies().get(REF_COOKIE)?.value;
        const inviter = refCode ? await findInviter(admin, refCode) : null;
        await sendInviteWelcomeEmail({
          to: email,
          firstName,
          invitedBy: inviter ? String(inviter.display_name || '').trim().split(/\s+/)[0] || null : null,
        });
      }
    } catch (e) {
      console.warn('[notify] invite welcome failed', e?.message || e);
    }
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
    // everything below was typed by a stranger: escape it so a name like  <a href=...>  can't
    // put a live link or markup into the email that lands in the host's inbox
    const linkedinLine = linkedinUrl ? `<br><a href="${escHtml(linkedinUrl)}">${escHtml(linkedinUrl)}</a>` : '';
    fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>',
        to: [notifyTo],
        subject: `✦ ${firstName} just signed up for good chats`,
        html: `<p><strong>${escHtml(firstName)}</strong> (${escHtml(email)}) signed up for good chats notifications.${linkedinLine}</p><p>${subscribeToWeekly ? '✓ opted in to The Weekly' : '✗ did not opt in to The Weekly'}</p>`,
      }),
    }).catch((e) => console.warn('[notify] host email failed', e?.message));
  }

  return NextResponse.json({ ok: true });
}
