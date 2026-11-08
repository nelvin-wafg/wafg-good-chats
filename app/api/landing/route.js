import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { pickNextSession } from '@/lib/next-session';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// belt and braces with adminClient()'s no-store fetch: never reuse a cached database read here
export const fetchCache = 'force-no-store';

// never let a browser or the CDN hold on to this: it's the homepage's "next session" and
// it changes the moment a host publishes, goes live, or ends a session.
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

// GET /api/landing
// Public · returns the currently-published "next session" for the homepage, plus the
// server's clock (serverNow) so the countdown can't be thrown off by a wrong computer
// clock. a session shows when:
//   - metadata.is_published === true
//   - status is NOT 'ended'
//   - it isn't a draft whose start time passed more than 12h ago
// the host controls publish state from the new-session wizard.
//
// ?debug=1 (approved hosts only) adds what the query actually saw, so "why isn't my
// session on the homepage?" can be answered from one request.
export async function GET(request) {
  const admin = adminClient();
  const now = Date.now();

  const { data, error } = await admin
    .from('sessions')
    .select('id, code, name, status, metadata, created_at')
    .neq('status', 'ended')
    .order('created_at', { ascending: false });
  // this used to swallow a failed query as "nothing published", which looks exactly like
  // "no session" and is impossible to tell apart. now it's logged.
  if (error) console.error('[landing] sessions query failed', error.message);

  const rows = Array.isArray(data) ? data : [];
  const { chosen, published, upcoming } = pickNextSession(rows, now);

  const body = {
    next: chosen
      ? {
          code: chosen.code,
          name: chosen.name,
          status: chosen.status, // 'draft' | 'live' | 'running_round' | 'closing'
          startsAt: chosen.metadata?.starts_at || null,
        }
      : null,
    serverNow: now,
  };

  if (new URL(request.url).searchParams.get('debug') === '1') {
    const auth = await getApprovedHost();
    if (auth) {
      body.debug = {
        queryError: error ? error.message : null,
        nonEndedSessions: rows.length,
        published: published.length,
        upcoming: upcoming.length,
        sessions: rows.slice(0, 10).map((s) => ({
          code: s.code,
          status: s.status,
          is_published: s.metadata?.is_published ?? null,
          starts_at: s.metadata?.starts_at ?? null,
        })),
      };
    }
  }

  return NextResponse.json(body, { headers: NO_STORE });
}
