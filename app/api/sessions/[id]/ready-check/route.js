import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';
import { buildReadyCheck } from '@/lib/ready-check';

export const dynamic = 'force-dynamic';
const WINDOW_MS = 30 * 60 * 1000; // waiting-room mic checks happen minutes before the round

// GET /api/sessions/:id/ready-check  (approved hosts only)
// who in the room might have trouble: silent or blocked mics, connections that keep dropping,
// people who won't be paired, people who just joined. see lib/ready-check.js.
export async function GET(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const [{ data: participants }, { data: events }] = await Promise.all([
    admin.from('participants').select('id, name, is_present, kicked_at, joined_at, last_seen').eq('session_id', sessionId),
    // newest first so a busy room can never push the latest signals out of the window
    admin.from('connection_events')
      .select('participant_id, event_type, payload, created_at')
      .eq('session_id', sessionId)
      .eq('role', 'participant')
      .in('event_type', ['track-state-change', 'network-connection', 'mic-state'])
      .gte('created_at', new Date(Date.now() - WINDOW_MS).toISOString())
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  return NextResponse.json(buildReadyCheck({ participants: participants || [], events: events || [] }), {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
