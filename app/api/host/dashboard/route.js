import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/host/dashboard
// returns all the aggregated data the host dashboard needs in one fetch.
// scoped to the calling host's primary sessions (sessions.host_id = user.id).
export async function GET() {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });
  const userId = auth.user.id;

  const admin = adminClient();

  // primary sessions owned by this host
  const { data: sessions = [] } = await admin
    .from('sessions')
    .select('*')
    .eq('host_id', userId)
    .order('created_at', { ascending: false });
  const sessionIds = sessions.map((s) => s.id);
  const safeIds = sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000'];

  const [{ data: captures = [] }, { data: participants = [] }] = await Promise.all([
    admin.from('captures').select('id, session_id, capturer_id, created_at').in('session_id', safeIds),
    admin.from('participants').select('id, session_id, profile_id, name, joined_at').in('session_id', safeIds),
  ]);

  const profileIds = [...new Set(participants.filter((p) => p.profile_id).map((p) => p.profile_id))];
  const safeProfileIds = profileIds.length > 0 ? profileIds : ['00000000-0000-0000-0000-000000000000'];
  const { data: profiles = [] } = await admin
    .from('profiles')
    .select('id, email, display_name, newsletter_opt_in, kit_synced_at')
    .in('id', safeProfileIds);

  // per-session stats
  const sessionStats = {};
  for (const s of sessions) {
    sessionStats[s.id] = {
      attendance: 0,
      captures: 0,
      capturers: new Set(),
      profileIdsThisSession: new Set(),
    };
  }
  for (const p of participants) {
    const stats = sessionStats[p.session_id];
    if (!stats) continue;
    stats.attendance++;
    if (p.profile_id) stats.profileIdsThisSession.add(p.profile_id);
  }
  for (const c of captures) {
    const stats = sessionStats[c.session_id];
    if (!stats) continue;
    stats.captures++;
    stats.capturers.add(c.capturer_id);
  }

  // returning vs new participants per session (across this host's sessions only)
  const profileFirstSeenAt = {}; // profile_id -> Date
  const sortedParticipants = [...participants].sort(
    (a, b) => new Date(a.joined_at).getTime() - new Date(b.joined_at).getTime()
  );
  for (const p of sortedParticipants) {
    if (p.profile_id && !profileFirstSeenAt[p.profile_id]) {
      profileFirstSeenAt[p.profile_id] = { sessionId: p.session_id, joinedAt: p.joined_at };
    }
  }
  for (const s of sessions) {
    const stats = sessionStats[s.id];
    if (!stats) continue;
    let returning = 0, newCount = 0;
    for (const pid of stats.profileIdsThisSession) {
      if (profileFirstSeenAt[pid]?.sessionId === s.id) newCount++;
      else returning++;
    }
    stats.returning = returning;
    stats.newCount = newCount;
    stats.engagement_pct = stats.attendance > 0
      ? Math.round((stats.capturers.size / stats.attendance) * 100)
      : 0;
  }

  // top connectors across all your sessions (top 5)
  const captureCountByCapturer = {};
  for (const c of captures) {
    captureCountByCapturer[c.capturer_id] = (captureCountByCapturer[c.capturer_id] || 0) + 1;
  }
  const participantById = Object.fromEntries(participants.map((p) => [p.id, p]));
  const profileById = Object.fromEntries(profiles.map((p) => [p.id, p]));
  // dedupe by profile_id (one person across multiple sessions)
  const connectorsByProfile = {};
  for (const [capturerId, count] of Object.entries(captureCountByCapturer)) {
    const p = participantById[capturerId];
    if (!p) continue;
    const key = p.profile_id || `noprofile-${p.id}`;
    if (!connectorsByProfile[key]) {
      connectorsByProfile[key] = {
        // profile_id when we have one · null otherwise (noprofile entries can
        // still be wiped per-participant via participant_id below)
        profile_id: p.profile_id || null,
        participant_id: p.profile_id ? null : p.id,
        name: p.name,
        email: p.profile_id ? profileById[p.profile_id]?.email || null : null,
        captures: 0,
      };
    }
    connectorsByProfile[key].captures += count;
  }
  const topConnectors = Object.values(connectorsByProfile)
    .sort((a, b) => b.captures - a.captures)
    .slice(0, 5);

  // newsletter sync stats
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const syncedThisMonth = profiles.filter(
    (p) => p.kit_synced_at && new Date(p.kit_synced_at) >= monthStart
  ).length;
  const sortedSync = profiles
    .filter((p) => p.kit_synced_at)
    .sort((a, b) => new Date(b.kit_synced_at).getTime() - new Date(a.kit_synced_at).getTime());
  const lastSync = sortedSync[0]?.kit_synced_at || null;

  // totals
  const endedSessions = sessions.filter((s) => s.status === 'ended');
  const totalNewsletterOptIns = profiles.filter((p) => p.newsletter_opt_in).length;
  const totalSessionMinutes = endedSessions.reduce(
    (sum, s) => sum + Math.round((s.rounds_total || 0) * ((s.round_seconds || 0) / 60)),
    0
  );

  // trends: last 8 ended sessions, oldest to newest
  const recentEnded = [...endedSessions]
    .sort((a, b) => new Date(a.ended_at || a.created_at).getTime() - new Date(b.ended_at || b.created_at).getTime())
    .slice(-8);
  const trendsCaptures = recentEnded.map((s) => sessionStats[s.id]?.captures || 0);
  const trendsAttendance = recentEnded.map((s) => sessionStats[s.id]?.attendance || 0);
  const trendsMinutes = recentEnded.map((s) => Math.round((s.rounds_total || 0) * ((s.round_seconds || 0) / 60)));

  // categorize sessions
  const live = sessions.filter((s) =>
    ['live', 'running_round', 'between_rounds', 'closing'].includes(s.status)
  );
  const drafts = sessions.filter((s) => s.status === 'draft');
  const past = endedSessions.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    created_at: s.created_at,
    ended_at: s.ended_at,
    rounds_total: s.rounds_total,
    attendance: sessionStats[s.id]?.attendance || 0,
    captures: sessionStats[s.id]?.captures || 0,
    engagement_pct: sessionStats[s.id]?.engagement_pct || 0,
    returning: sessionStats[s.id]?.returning || 0,
    newCount: sessionStats[s.id]?.newCount || 0,
  }));

  return NextResponse.json({
    host: { display_name: auth.host.display_name, email: auth.host.email },
    totals: {
      sessionsHosted: endedSessions.length,
      totalConnections: captures.length,
      totalParticipants: profileIds.length,
      totalNewsletterOptIns,
      totalSessionMinutes,
      yearLabel: new Date().getFullYear(),
    },
    newsletter: { syncedThisMonth, lastSyncedAt: lastSync },
    live: live.map((s) => ({
      id: s.id, code: s.code, name: s.name, status: s.status,
      current_round: s.current_round, rounds_total: s.rounds_total,
    })),
    drafts: drafts.map((s) => ({ id: s.id, code: s.code, name: s.name })),
    past,
    topConnectors,
    trends: { captures: trendsCaptures, attendance: trendsAttendance, minutes: trendsMinutes },
  });
}
