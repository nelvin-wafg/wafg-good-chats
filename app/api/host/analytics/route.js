import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/host/analytics
// returns trend data for the analytics page · scoped to your primary sessions.
export async function GET() {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });
  const userId = auth.user.id;

  const admin = adminClient();
  const { data: sessions = [] } = await admin
    .from('sessions')
    .select('id, code, name, status, rounds_total, round_seconds, created_at, ended_at, prompts')
    .eq('host_id', userId)
    .eq('status', 'ended')
    .order('ended_at', { ascending: true });

  const sessionIds = sessions.map((s) => s.id);
  const safe = sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000'];

  const [{ data: captures = [] }, { data: participants = [] }, { data: rounds = [] }] = await Promise.all([
    admin.from('captures').select('id, session_id, capturer_id').in('session_id', safe),
    admin.from('participants').select('id, session_id, profile_id').in('session_id', safe),
    admin.from('rounds').select('id, session_id, prompt_text, round_number').in('session_id', safe),
  ]);

  // sessions over time (per month)
  const monthBuckets = {};
  for (const s of sessions) {
    const d = new Date(s.ended_at || s.created_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthBuckets[key] = (monthBuckets[key] || 0) + 1;
  }
  const sessionsByMonth = Object.entries(monthBuckets)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12); // last 12 months

  // per-session attendance + captures + engagement
  const perSession = sessions.map((s) => {
    const att = participants.filter((p) => p.session_id === s.id);
    const caps = captures.filter((c) => c.session_id === s.id);
    const capturers = new Set(caps.map((c) => c.capturer_id));
    return {
      id: s.id,
      code: s.code,
      name: s.name,
      ended_at: s.ended_at,
      rounds_total: s.rounds_total,
      attendance: att.length,
      captures: caps.length,
      engagement_pct: att.length > 0 ? Math.round((capturers.size / att.length) * 100) : 0,
    };
  });

  // top prompts: which prompts had the most captures attributed (via round)
  // captures are tied to a pairing, which is tied to a round, which has a prompt.
  // we can join captures → pairings → rounds to get the prompt for each capture.
  const { data: pairings = [] } = await admin
    .from('pairings')
    .select('id, round_id, session_id')
    .in('session_id', safe);
  const roundById = Object.fromEntries(rounds.map((r) => [r.id, r]));
  const pairingById = Object.fromEntries(pairings.map((p) => [p.id, p]));
  const { data: capturesWithPair = [] } = await admin
    .from('captures')
    .select('id, pairing_id')
    .in('session_id', safe);
  const promptCounts = {};
  for (const c of capturesWithPair) {
    if (!c.pairing_id) continue;
    const pair = pairingById[c.pairing_id];
    if (!pair) continue;
    const round = roundById[pair.round_id];
    if (!round?.prompt_text) continue;
    promptCounts[round.prompt_text] = (promptCounts[round.prompt_text] || 0) + 1;
  }
  const topPrompts = Object.entries(promptCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([prompt, captures]) => ({ prompt, captures }));

  return NextResponse.json({
    sessionsByMonth: sessionsByMonth.map(([month, count]) => ({ month, count })),
    perSession,
    topPrompts,
  });
}
