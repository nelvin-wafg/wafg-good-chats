import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET /api/host/engagement  (approved hosts only)
// "what happens after the call": for the last few sessions, how many people were there, how many
// got a recap and a follow-up, and how many clicked a LinkedIn link; plus the invite funnel.
// counts of clicks are "at most this many people": a few email scanners open links on their own.
export async function GET() {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('Forbidden', { status: 403 });
  const admin = adminClient();
  const out = { sessions: [], invites: { opened: 0, interested: 0, joined: 0 }, setupNeeded: { clicks: false, followups: false, invites: false } };

  const { data: sessions } = await admin
    .from('sessions').select('id, name, ended_at').eq('status', 'ended').order('ended_at', { ascending: false }).limit(8);
  const list = sessions || [];
  const ids = list.map((s) => s.id);

  let parts = [];
  if (ids.length) {
    const r = await admin.from('participants').select('id, session_id, followup_sent_at, profiles(email_verified_at)').in('session_id', ids);
    if (r.error) {
      // followup_sent_at not there yet: read without it
      out.setupNeeded.followups = true;
      const r2 = await admin.from('participants').select('id, session_id, profiles(email_verified_at)').in('session_id', ids);
      parts = r2.data || [];
    } else parts = r.data || [];
  }

  let clicks = [];
  if (ids.length) {
    const r = await admin.from('link_clicks').select('profile_id, session_id, kind, is_bot').in('session_id', ids).eq('is_bot', false);
    if (r.error) out.setupNeeded.clicks = true; else clicks = r.data || [];
  }

  for (const s of list) {
    const mine = parts.filter((p) => p.session_id === s.id);
    const lc = clicks.filter((c) => c.session_id === s.id && /linkedin/.test(c.kind));
    out.sessions.push({
      id: s.id,
      name: s.name,
      date: s.ended_at,
      people: mine.length,
      recaps: mine.filter((p) => p.profiles?.email_verified_at).length, // recaps go to verified emails
      followUps: mine.filter((p) => p.followup_sent_at).length,
      linkedinClickers: new Set(lc.map((c) => c.profile_id).filter(Boolean)).size,
    });
  }

  const ev = await admin.from('referral_events').select('event, visitor_key');
  if (ev.error) out.setupNeeded.invites = true;
  else {
    const rows = ev.data || [];
    out.invites.opened = rows.filter((e) => e.event === 'visit').length;
    out.invites.interested = new Set(rows.filter((e) => e.event === 'signup' || e.event === 'rsvp').map((e) => e.visitor_key)).size;
    const j = await admin.from('profiles').select('id', { count: 'exact', head: true }).not('referred_by', 'is', null);
    out.invites.joined = j.count || 0;
  }
  return NextResponse.json(out);
}
