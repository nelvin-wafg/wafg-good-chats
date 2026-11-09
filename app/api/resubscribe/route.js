import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { verifyResubscribeToken } from '@/lib/resubscribe';

export const dynamic = 'force-dynamic';

// POST /api/resubscribe?t=<signed token>
// the person pressed "yes, add me back" on /resubscribe. it is a POST, never a GET, because email
// scanners open every link in a message and would otherwise re-subscribe people who never clicked.
// the signed token carries the email, so nobody can re-subscribe an address they weren't sent a link for.
export async function POST(request) {
  if (!(await rateLimitByIp(request, 'resubscribe', { limit: 20, windowSeconds: 60 }))) {
    return new NextResponse('Too many tries · give it a minute', { status: 429 });
  }
  const token = new URL(request.url).searchParams.get('t') || '';
  const email = verifyResubscribeToken(token);
  if (!email) return new NextResponse("This link isn't valid or has expired", { status: 400 });

  const admin = adminClient();
  const { error } = await admin.from('email_unsubscribes').delete().eq('email', email);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return new NextResponse("This isn't fully switched on yet · please try again later", { status: 503 });
    console.error('[resubscribe] failed', error.message);
    return new NextResponse("Couldn't add you back · try again", { status: 500 });
  }

  // unsubscribing marks every pending sign-up as already emailed (so no announcement goes out). make
  // sure there is a fresh, un-emailed one, or the person would be "back" but never actually announced to
  try {
    const { data: rows } = await admin.from('notify_signups').select('id, first_name, notified_at').eq('email', email);
    const hasPending = (rows || []).some((r) => !r.notified_at);
    if (!hasPending) {
      await admin.from('notify_signups').insert({
        email,
        first_name: (rows || []).find((r) => r.first_name)?.first_name || null,
        source: 'confirmed again after unsubscribing',
        subscribed_to_weekly: false,
      });
    }
  } catch (e) {
    console.warn('[resubscribe] could not add a pending sign-up', e?.message || e);
  }
  return NextResponse.json({ ok: true });
}
