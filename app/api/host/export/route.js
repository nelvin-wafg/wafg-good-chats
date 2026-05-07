import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { toCSV, csvResponse } from '@/lib/csv';

// GET /api/host/export  — CSV of every participant across every session you've hosted.
// row format: session_name, session_date, participant_name, participant_email, participant_linkedin,
//             newsletter_opt_in, joined_at, left_at, captures_made, captures_received
export async function GET() {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });
  const userId = auth.user.id;

  const admin = adminClient();
  const { data: sessions = [] } = await admin
    .from('sessions')
    .select('id, name, code, created_at')
    .eq('host_id', userId)
    .order('created_at', { ascending: false });

  const sessionIds = sessions.map((s) => s.id);
  const safe = sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000'];
  const sessionById = Object.fromEntries(sessions.map((s) => [s.id, s]));

  const [{ data: participants = [] }, { data: captures = [] }] = await Promise.all([
    admin
      .from('participants')
      .select('id, session_id, name, joined_at, left_at, profiles(email, linkedin_url, newsletter_opt_in)')
      .in('session_id', safe),
    admin
      .from('captures')
      .select('capturer_id, captured_id, session_id')
      .in('session_id', safe),
  ]);

  const capturesMade = {};
  const capturesReceived = {};
  for (const c of captures) {
    capturesMade[c.capturer_id] = (capturesMade[c.capturer_id] || 0) + 1;
    capturesReceived[c.captured_id] = (capturesReceived[c.captured_id] || 0) + 1;
  }

  const rows = participants.map((p) => {
    const s = sessionById[p.session_id];
    return {
      session_name: s?.name || '',
      session_date: (s?.created_at || '').slice(0, 10),
      session_code: s?.code || '',
      participant_name: p.name,
      participant_email: p.profiles?.email || '',
      participant_linkedin: p.profiles?.linkedin_url || '',
      newsletter_opt_in: p.profiles?.newsletter_opt_in ? 'yes' : 'no',
      joined_at: p.joined_at || '',
      left_at: p.left_at || '',
      captures_made: capturesMade[p.id] || 0,
      captures_received: capturesReceived[p.id] || 0,
    };
  });

  const csv = toCSV(rows, [
    'session_name', 'session_date', 'session_code',
    'participant_name', 'participant_email', 'participant_linkedin', 'newsletter_opt_in',
    'joined_at', 'left_at', 'captures_made', 'captures_received',
  ]);
  const filename = `wafg-all-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  return csvResponse(csv, filename);
}
