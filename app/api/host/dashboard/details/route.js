import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/host/dashboard/details?kind=sessions|captures|people|newsletter|minutes
// Returns the row list backing a clicked stat card on the host dashboard.
// Always scoped to the calling host's sessions (host_id = user.id).
export async function GET(request) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');

  const admin = adminClient();
  const { data: sessions = [] } = await admin
    .from('sessions')
    .select('id, name, code, created_at, ended_at, rounds_total, round_seconds, status')
    .eq('host_id', auth.user.id)
    .order('created_at', { ascending: false });
  const sessionIds = sessions.map((s) => s.id);
  const safe = sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000'];
  const sessionById = Object.fromEntries(sessions.map((s) => [s.id, s]));

  if (kind === 'sessions') {
    const [{ data: participants = [] }, { data: captures = [] }] = await Promise.all([
      admin.from('participants').select('id, session_id').in('session_id', safe),
      admin.from('captures').select('id, session_id').in('session_id', safe),
    ]);
    const attBySession = {};
    const capBySession = {};
    for (const p of participants) attBySession[p.session_id] = (attBySession[p.session_id] || 0) + 1;
    for (const c of captures) capBySession[c.session_id] = (capBySession[c.session_id] || 0) + 1;
    const rows = sessions.map((s) => ({
      id: s.id, name: s.name, code: s.code, status: s.status,
      date: s.created_at, ended_at: s.ended_at,
      rounds: s.rounds_total,
      attendance: attBySession[s.id] || 0,
      captures: capBySession[s.id] || 0,
      minutes: Math.round((s.rounds_total || 0) * ((s.round_seconds || 0) / 60)),
    }));
    return NextResponse.json({ kind, rows });
  }

  if (kind === 'captures') {
    const { data: captures = [] } = await admin
      .from('captures')
      .select('id, session_id, capturer_id, captured_id, captured_name, captured_email, captured_linkedin_url, created_at')
      .in('session_id', safe)
      .order('created_at', { ascending: false });
    const capturerIds = [...new Set(captures.map((c) => c.capturer_id))];
    const safeCap = capturerIds.length > 0 ? capturerIds : ['00000000-0000-0000-0000-000000000000'];
    const { data: capturers = [] } = await admin
      .from('participants')
      .select('id, name')
      .in('id', safeCap);
    const capturerById = Object.fromEntries(capturers.map((c) => [c.id, c.name]));
    const rows = captures.map((c) => ({
      id: c.id,
      session_name: sessionById[c.session_id]?.name || '',
      capturer: capturerById[c.capturer_id] || '(unknown)',
      captured: c.captured_name || '(unknown)',
      captured_email: c.captured_email || null,
      captured_linkedin: c.captured_linkedin_url || null,
      created_at: c.created_at,
    }));
    return NextResponse.json({ kind, rows });
  }

  if (kind === 'people' || kind === 'newsletter') {
    const { data: participants = [] } = await admin
      .from('participants')
      .select('id, session_id, profile_id, joined_at')
      .in('session_id', safe);
    const profileIds = [...new Set(participants.filter((p) => p.profile_id).map((p) => p.profile_id))];
    const safeProf = profileIds.length > 0 ? profileIds : ['00000000-0000-0000-0000-000000000000'];
    const { data: profiles = [] } = await admin
      .from('profiles')
      .select('id, email, display_name, linkedin_url, newsletter_opt_in, kit_synced_at, created_at')
      .in('id', safeProf);
    const attendByProf = {};
    const lastSeenByProf = {};
    for (const p of participants) {
      if (!p.profile_id) continue;
      attendByProf[p.profile_id] = (attendByProf[p.profile_id] || 0) + 1;
      const t = p.joined_at;
      if (t && (!lastSeenByProf[p.profile_id] || t > lastSeenByProf[p.profile_id])) {
        lastSeenByProf[p.profile_id] = t;
      }
    }
    let rows = profiles.map((pf) => ({
      id: pf.id,
      name: pf.display_name,
      email: pf.email,
      linkedin: pf.linkedin_url,
      newsletter_opt_in: pf.newsletter_opt_in,
      kit_synced_at: pf.kit_synced_at,
      events_attended: attendByProf[pf.id] || 0,
      last_seen: lastSeenByProf[pf.id] || pf.created_at,
    }));
    if (kind === 'newsletter') rows = rows.filter((r) => r.newsletter_opt_in);
    rows.sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));
    return NextResponse.json({ kind, rows });
  }

  if (kind === 'minutes') {
    const rows = sessions
      .filter((s) => s.status === 'ended')
      .map((s) => ({
        id: s.id,
        name: s.name,
        date: s.created_at,
        rounds: s.rounds_total,
        minutes: Math.round((s.rounds_total || 0) * ((s.round_seconds || 0) / 60)),
      }))
      .sort((a, b) => b.minutes - a.minutes);
    return NextResponse.json({ kind, rows });
  }

  return new NextResponse('unknown kind', { status: 400 });
}
