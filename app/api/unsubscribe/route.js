import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { verifyUnsubscribeToken } from '@/lib/unsubscribe';

export const dynamic = 'force-dynamic';

// GET /api/unsubscribe?t=<token>
// a GET must NEVER unsubscribe anyone: email security scanners and link previewers open every
// link in a message, so a GET that acted would silently unsubscribe people who never clicked.
// humans who land here are sent to the confirm page instead.
export async function GET(request) {
  const t = new URL(request.url).searchParams.get('t') || '';
  return NextResponse.redirect(new URL(`/unsubscribe?t=${encodeURIComponent(t)}`, request.url), 303);
}

// POST /api/unsubscribe?t=<token>
// two callers: the confirm page's button, and mail clients' one-click "Unsubscribe" button
// (RFC 8058: they POST "List-Unsubscribe=One-Click" to the URL in the List-Unsubscribe
// header). the signed token carries the email, so nobody can unsubscribe an address they
// weren't sent a link for.
export async function POST(request) {
  const allowed = await rateLimitByIp(request, 'unsubscribe', { limit: 20, windowSeconds: 60 });
  if (!allowed) return new NextResponse('too many tries · give it a minute', { status: 429 });

  const raw = await request.text().catch(() => '');
  let token = new URL(request.url).searchParams.get('t') || '';
  if (!token && raw.trim().startsWith('{')) {
    try { token = JSON.parse(raw)?.t || ''; } catch {}
  }
  const source = raw.includes('List-Unsubscribe=One-Click') ? 'one-click' : 'link';

  const email = verifyUnsubscribeToken(token);
  if (!email) return new NextResponse("this unsubscribe link isn't valid", { status: 400 });

  const admin = adminClient();

  // stop the homepage-list announcements right away (works even before the new table exists)
  await admin
    .from('notify_signups')
    .update({ notified_at: new Date().toISOString() })
    .eq('email', email)
    .is('notified_at', null);

  // and record it for everything else (go-live emails, saved spots, future sends)
  const { error } = await admin
    .from('email_unsubscribes')
    .upsert([{ email, source }], { onConflict: 'email', ignoreDuplicates: true });
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') {
      return new NextResponse("unsubscribe isn't fully switched on yet · please try again later", { status: 503 });
    }
    console.error('[unsubscribe] failed', error.message);
    return new NextResponse("couldn't unsubscribe you · try again", { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
