import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { toCSV, csvResponse } from '@/lib/csv';

// GET /api/host/export/people
// A deduplicated contact list: one row per unique PERSON (by profile) across
// every session you've hosted — not one row per session attendance.
// columns: name, email, linkedin, newsletter_opt_in, events_attended,
//          first_seen, last_seen, captures_made, captures_received
export async function GET() {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });
  const userId = auth.user.id;

  const admin = adminClient();
  const { data: sessions = [] } = await admin
    .from('sessions')
    .select('id')
    .eq('host_id', userId);

  const sessionIds = sessions.map((s) => s.id);
  const safe = sessionIds.length > 0 ? sessionIds : ['00000000-0000-0000-0000-000000000000'];

  const [{ data: participants = [] }, { data: captures = [] }] = await Promise.all([
    admin
      .from('participants')
      .select('id, profile_id, name, joined_at, profiles(email, display_name, linkedin_url, newsletter_opt_in)')
      .in('session_id', safe),
    admin
      .from('captures')
      .select('capturer_id, captured_id')
      .in('session_id', safe),
  ]);

  // map each session-participant row to its person (profile). fall back to the
  // participant id if a profile somehow isn't linked, so nobody is dropped.
  const participantToPerson = {};
  for (const p of participants) {
    participantToPerson[p.id] = p.profile_id || `participant:${p.id}`;
  }

  // tally captures per person
  const capturesMade = {};
  const capturesReceived = {};
  for (const c of captures) {
    const maker = participantToPerson[c.capturer_id];
    const receiver = participantToPerson[c.captured_id];
    if (maker) capturesMade[maker] = (capturesMade[maker] || 0) + 1;
    if (receiver) capturesReceived[receiver] = (capturesReceived[receiver] || 0) + 1;
  }

  // collapse session-attendance rows into one record per person
  const people = {};
  for (const p of participants) {
    const key = p.profile_id || `participant:${p.id}`;
    const joined = p.joined_at || '';
    if (!people[key]) {
      people[key] = {
        name: p.profiles?.display_name || p.name || '',
        email: p.profiles?.email || '',
        linkedin: p.profiles?.linkedin_url || '',
        newsletter_opt_in: p.profiles?.newsletter_opt_in ? 'yes' : 'no',
        events_attended: 0,
        first_seen: joined,
        last_seen: joined,
      };
    }
    const rec = people[key];
    rec.events_attended += 1;
    if (joined && (!rec.first_seen || joined < rec.first_seen)) rec.first_seen = joined;
    if (joined && (!rec.last_seen || joined > rec.last_seen)) rec.last_seen = joined;
    // keep the most complete name/profile fields we've seen
    if (!rec.email && p.profiles?.email) rec.email = p.profiles.email;
    if (!rec.linkedin && p.profiles?.linkedin_url) rec.linkedin = p.profiles.linkedin_url;
  }

  const rows = Object.entries(people)
    .map(([key, rec]) => ({
      ...rec,
      first_seen: (rec.first_seen || '').slice(0, 10),
      last_seen: (rec.last_seen || '').slice(0, 10),
      captures_made: capturesMade[key] || 0,
      captures_received: capturesReceived[key] || 0,
    }))
    // most recently seen first
    .sort((a, b) => (b.last_seen || '').localeCompare(a.last_seen || ''));

  const csv = toCSV(rows, [
    'name', 'email', 'linkedin', 'newsletter_opt_in',
    'events_attended', 'first_seen', 'last_seen',
    'captures_made', 'captures_received',
  ]);
  const filename = `wafg-people-${new Date().toISOString().slice(0, 10)}.csv`;
  return csvResponse(csv, filename);
}
