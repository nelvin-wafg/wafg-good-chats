import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { toCSV, csvResponse } from '@/lib/csv';
import { loadNotifyList } from '@/lib/notify-list';

export const dynamic = 'force-dynamic';

// GET /api/host/export/notify
// the homepage notify list as a CSV: one row per person (not per signup), with where they stand.
export async function GET() {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let list;
  try {
    list = await loadNotifyList(adminClient());
  } catch (e) {
    console.error('[export/notify] failed', e?.message || e);
    return new NextResponse("couldn't load the notify list", { status: 500 });
  }

  const rows = list.rows.map((r) => ({
    email: r.email,
    first_name: r.name || '',
    linkedin: r.linkedin || '',
    how_they_heard: r.source || '',
    in_kit_weekly: r.inKitWeekly ? 'yes' : 'no',
    signed_up: (r.firstSignedUp || '').slice(0, 10),
    times_signed_up: r.signups,
    status: r.status,
    last_emailed: (r.lastEmailedAt || '').slice(0, 10),
  }));
  const csv = toCSV(rows, [
    'email', 'first_name', 'linkedin', 'how_they_heard', 'in_kit_weekly',
    'signed_up', 'times_signed_up', 'status', 'last_emailed',
  ]);
  return csvResponse(csv, `wafg-notify-list-${new Date().toISOString().slice(0, 10)}.csv`);
}
