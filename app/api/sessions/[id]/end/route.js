import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { deleteRoom } from '@/lib/daily';
import { sendRecapEmail } from '@/lib/resend';

// POST /api/sessions/:id/end  — any approved host ends the session
export async function POST(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('not an approved host', { status: 403 });

  const admin = adminClient();
  const { data: session } = await admin.from('sessions').select('*').eq('id', params.id).single();
  if (!session) return new NextResponse('session not found', { status: 404 });

  // tear down all daily rooms (main + any active pair rooms)
  const { data: pairings = [] } = await admin.from('pairings').select('room_name').eq('session_id', session.id);
  const cleanupPromises = pairings.filter((p) => p.room_name).map((p) => deleteRoom(p.room_name).catch(() => {}));
  if (session.main_room_name) cleanupPromises.push(deleteRoom(session.main_room_name).catch(() => {}));
  await Promise.all(cleanupPromises);

  await admin
    .from('participants')
    .update({ current_room_name: null, is_present: false, left_at: new Date().toISOString() })
    .eq('session_id', session.id);

  await admin
    .from('sessions')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', session.id);

  // fire recap emails to all participants who have a profile email · non-blocking
  try {
    const [{ data: participants }, { data: captures }, { data: rounds }] = await Promise.all([
      admin.from('participants')
        .select('id, name, profiles(email)')
        .eq('session_id', session.id),
      admin.from('captures')
        .select('capturer_id, captured_name, captured_linkedin_url')
        .eq('session_id', session.id),
      admin.from('rounds')
        .select('round_number, prompt_text')
        .eq('session_id', session.id)
        .order('round_number', { ascending: true }),
    ]);

    const capturesByParticipant = (captures || []).reduce((acc, c) => {
      if (!acc[c.capturer_id]) acc[c.capturer_id] = [];
      acc[c.capturer_id].push({ captured_name: c.captured_name, captured_linkedin_url: c.captured_linkedin_url });
      return acc;
    }, {});

    const emailPromises = (participants || [])
      .filter((p) => p.profiles?.email)
      .map((p) => sendRecapEmail({
        to: p.profiles.email,
        participantName: p.name,
        sessionName: session.name,
        captures: capturesByParticipant[p.id] || [],
        prompts: rounds || [],
      }).catch((e) => console.error('[end] recap email failed for participant', p.id, e?.message)));

    // don't await — let emails send in the background so the host isn't blocked
    Promise.all(emailPromises).catch(() => {});
  } catch (e) {
    // recap email errors must never block the session end response
    console.error('[end] recap email batch error', e?.message || e);
  }

  return NextResponse.json({ ok: true });
}
