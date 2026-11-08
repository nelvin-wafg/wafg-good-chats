import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { rateLimitByIp } from '@/lib/rate-limit';
import { verifyTrackedLink, isLikelyBot } from '@/lib/track-link';

export const dynamic = 'force-dynamic';
const SITE = 'https://goodchats.weareforgood.com';

// GET /go/<token>  · records the click on a tracked email link, then forwards to the signed
// destination. an unknown or altered token goes to the homepage, never to an arbitrary site.
// tracking is best-effort: if it fails, or this IP is clicking suspiciously fast, the person is
// still forwarded.
export async function GET(request, { params }) {
  const link = verifyTrackedLink(params.token);
  if (!link) return NextResponse.redirect(SITE, 302);

  try {
    if (await rateLimitByIp(request, 'go', { limit: 120, windowSeconds: 60 })) {
      await adminClient().from('link_clicks').insert({
        profile_id: link.profileId,
        session_id: link.sessionId,
        kind: link.kind,
        target_host: new URL(link.url).hostname,
        is_bot: isLikelyBot(request.headers.get('user-agent')),
      });
    }
  } catch {}
  return NextResponse.redirect(link.url, 302);
}
