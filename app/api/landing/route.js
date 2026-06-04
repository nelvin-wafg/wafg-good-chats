import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

// GET /api/landing
// Public · returns the currently-published "next session" for the homepage,
// or null if nothing's published. A session shows on the landing when:
//   - metadata.is_published === true
//   - status is NOT 'ended'
// The host controls publish state from the new-session wizard.
export async function GET() {
  const admin = adminClient();

  // pull the candidates · the active set is tiny so this stays cheap even
  // without a dedicated index on metadata.is_published.
  const { data: rows = [] } = await admin
    .from('sessions')
    .select('id, code, name, status, metadata, created_at')
    .neq('status', 'ended')
    .order('created_at', { ascending: false });

  // pick the soonest published session (by starts_at if present, else newest)
  const published = (rows || []).filter((s) => s?.metadata?.is_published === true);
  if (published.length === 0) {
    return NextResponse.json({ next: null });
  }

  // sort: sessions with a starts_at come first (sorted ascending by that date),
  // then sessions without a starts_at sorted by created_at descending.
  const withStart = published.filter((s) => s.metadata?.starts_at);
  const withoutStart = published.filter((s) => !s.metadata?.starts_at);
  withStart.sort((a, b) =>
    new Date(a.metadata.starts_at).getTime() - new Date(b.metadata.starts_at).getTime()
  );
  withoutStart.sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const chosen = withStart[0] || withoutStart[0];
  if (!chosen) return NextResponse.json({ next: null });

  return NextResponse.json({
    next: {
      code: chosen.code,
      name: chosen.name,
      status: chosen.status, // 'draft' | 'live' | 'running_round' | 'between_rounds' | 'closing'
      startsAt: chosen.metadata?.starts_at || null,
    },
  });
}
