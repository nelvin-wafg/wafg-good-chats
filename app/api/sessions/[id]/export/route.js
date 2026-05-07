import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { toCSV, csvResponse } from '@/lib/csv';

// GET /api/sessions/:id/export  — CSV of participants in this session with capture counts + linkedin
export async function GET(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, name, code, created_at')
    .eq('id', params.id)
    .maybeSingle();
  if (!session) return new NextResponse('not found', { status: 404 });

  const [{ data: participants = [] }, { data: captures = [] }] = await Promise.all([
    admin
      .from('participants')
      .select('id, name, joined_at, left_at, profiles(email, linkedin_url, newsletter_opt_in)')
      .eq('session_id', session.id),
    admin
      .from('captures')
      .select('capturer_id, captured_id')
      .eq('session_id', session.id),
  ]);

  const capturesMade = {};
  const capturesReceived = {};
  for (const c of captures) {
    capturesMade[c.capturer_id] = (capturesMade[c.capturer_id] || 0) + 1;
    capturesReceived[c.captured_id] = (capturesReceived[c.captured_id] || 0) + 1;
  }

  const rows = participants.map((p) => ({
    name: p.name,
    email: p.profiles?.email || '',
    linkedin: p.profiles?.linkedin_url || '',
    newsletter_opt_in: p.profiles?.newsletter_opt_in ? 'yes' : 'no',
    joined_at: p.joined_at || '',
    left_at: p.left_at || '',
    captures_made: capturesMade[p.id] || 0,
    captures_received: capturesReceived[p.id] || 0,
  }));

  const csv = toCSV(rows, [
    'name', 'email', 'linkedin', 'newsletter_opt_in',
    'joined_at', 'left_at', 'captures_made', 'captures_received',
  ]);
  const dateStr = (session.created_at || new Date().toISOString()).slice(0, 10);
  const filename = `${session.code}-${dateStr}.csv`;
  return csvResponse(csv, filename);
}
