import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { randomBytes } from 'crypto';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { getTrustedProfileId } from '@/lib/profile-trust';
import {
  REF_COOKIE, REF_COOKIE_OPTIONS, VISITOR_COOKIE, VISITOR_COOKIE_OPTIONS,
  INVITE_CODE_RE, findInviter, recordReferralEvent,
} from '@/lib/referral';

export const dynamic = 'force-dynamic';

// POST /api/referrals/visit  body: { code }
// called by the invite page in the browser (not on the server render, so link-preview bots and
// email scanners don't inflate the count). remembers who invited this browser (first link wins,
// 30 days) and counts the visit once per browser.
export async function POST(request) {
  if (!(await rateLimitByIp(request, 'referral-visit', { limit: 60, windowSeconds: 60 }))) {
    return new NextResponse('too many requests', { status: 429 });
  }
  let code;
  try {
    code = String((await request.json())?.code || '');
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }
  if (!INVITE_CODE_RE.test(code)) return NextResponse.json({ ok: true }); // unknown: say nothing

  const admin = adminClient();
  const inviter = await findInviter(admin, code);
  if (!inviter) return NextResponse.json({ ok: true });

  const jar = cookies();
  const res = NextResponse.json({ ok: true });

  // first touch: keep an existing valid inviter, otherwise remember this one
  const existing = jar.get(REF_COOKIE)?.value;
  if (!existing || !INVITE_CODE_RE.test(existing)) res.cookies.set(REF_COOKIE, code, REF_COOKIE_OPTIONS);

  let visitorId = jar.get(VISITOR_COOKIE)?.value;
  if (!visitorId || visitorId.length < 16) {
    visitorId = randomBytes(12).toString('base64url');
    res.cookies.set(VISITOR_COOKIE, visitorId, VISITOR_COOKIE_OPTIONS);
  }

  // the inviter opening their own link doesn't count as a visit
  if (getTrustedProfileId(jar) !== inviter.id) {
    await recordReferralEvent(admin, { referrerId: inviter.id, visitorKey: `v:${visitorId}`, event: 'visit' });
  }
  return res;
}
