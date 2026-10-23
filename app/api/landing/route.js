import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// belt and braces with adminClient()'s no-store fetch: never reuse a cached database read here
export const fetchCache = 'force-no-store';

// never let a browser or the CDN hold on to this: it's the homepage's "next session" and
// it changes the moment a host publishes, goes live, or ends a session.
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

// a published DRAFT whose start time passed long ago is a leftover, not an upcoming
// session · don't keep advertising it with a countdown that has run out.
const STALE_DRAFT_MS = 12 * 60 * 60 * 1000;

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
  const published = rows.filter((s) => s?.metadata?.is_published === true);
  const upcoming = published.filter((s) => {
    if (s.status !== 'draft') return true;
    const t = s.metadata?.starts_at ? new Date(s.metadata.starts_at).getTime() : NaN;
    return !(Number.isFinite(t) && now - t > STALE_DRAFT_MS);
  });

  // soonest start first; sessions without a start time come after, newest first
  const withStart = upcoming.filter((s) => s.metadata?.starts_at);
  const withoutStart = upcoming.filter((s) => !s.metadata?.starts_at);
  withStart.sort((a, b) => new Date(a.metadata.starts_at).getTime() - new Date(b.metadata.starts_at).getTime());
  withoutStart.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const chosen = withStart[0] || withoutStart[0] || null;

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
