import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { deleteRoom } from '@/lib/daily';

export const dynamic = 'force-dynamic';

// GET /api/cron/cleanup
// scheduled daily by vercel.json. two jobs:
//   1. prune the rate_limits table (rows older than 1 hour)
//   2. reap stale sessions · active sessions where everyone's been gone for >1 hour,
//      or empty sessions created >6 hours ago. ends them + frees daily rooms.
//
// protected by CRON_SECRET when set. vercel cron sends Authorization: Bearer <CRON_SECRET>
// automatically if the env var exists.
export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${secret}`) {
      return new NextResponse('unauthorized', { status: 401 });
    }
  }

  const admin = adminClient();
  const result = { rateLimitsPruned: false, sessionsReaped: [] };

  // 1. prune rate_limits
  try {
    await admin.rpc('cleanup_rate_limits');
    result.rateLimitsPruned = true;
  } catch (e) {
    console.error('[cron] rate_limits cleanup failed', e?.message || e);
  }

  // 2. reap stale active sessions
  try {
    const now = Date.now();
    const ONE_HOUR = 60 * 60 * 1000;
    const SIX_HOURS = 6 * ONE_HOUR;

    const { data: activeSessions = [] } = await admin
      .from('sessions')
      .select('id, created_at, main_room_name')
      .in('status', ['live', 'running_round', 'between_rounds', 'closing']);

    for (const s of activeSessions) {
      // most recent participant heartbeat for this session
      const { data: recent } = await admin
        .from('participants')
        .select('last_seen')
        .eq('session_id', s.id)
        .order('last_seen', { ascending: false })
        .limit(1)
        .maybeSingle();

      const lastSeen = recent?.last_seen ? new Date(recent.last_seen).getTime() : null;
      const createdAt = s.created_at ? new Date(s.created_at).getTime() : 0;

      const everyoneGone = lastSeen != null && now - lastSeen > ONE_HOUR;
      const emptyAndOld = lastSeen == null && now - createdAt > SIX_HOURS;

      if (everyoneGone || emptyAndOld) {
        // clean up daily rooms
        if (s.main_room_name) {
          try { await deleteRoom(s.main_room_name); } catch {}
        }
        const { data: pairings = [] } = await admin
          .from('pairings')
          .select('room_name')
          .eq('session_id', s.id);
        await Promise.all(
          pairings.filter((p) => p.room_name).map((p) => deleteRoom(p.room_name).catch(() => {}))
        );
        // end the session
        await admin
          .from('sessions')
          .update({ status: 'ended', ended_at: new Date().toISOString() })
          .eq('id', s.id);
        await admin
          .from('participants')
          .update({ is_present: false, current_room_name: null })
          .eq('session_id', s.id);
        result.sessionsReaped.push(s.id);
      }
    }
  } catch (e) {
    console.error('[cron] session reaper failed', e?.message || e);
  }

  return NextResponse.json({ ok: true, ...result });
}
