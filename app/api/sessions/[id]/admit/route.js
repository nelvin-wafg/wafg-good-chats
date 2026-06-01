import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/admit  body: { participantId } OR { all: true }
// host lets a waiting-room participant (or everyone) into the main room.
// admission is stored on participants.metadata.admitted_at; once it's set,
// the daily token route grants tokens and the state route flips me.admitted=true
// on the participant's next poll.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, participantId, all;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    if (body?.all === true) {
      all = true;
    } else {
      participantId = validateUuid(body?.participantId, 'participant id');
    }
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const now = new Date().toISOString();

  if (all) {
    // admit everyone currently waiting in this session
    const { data: rows = [] } = await admin
      .from('participants')
      .select('id, metadata')
      .eq('session_id', sessionId);
    const updates = rows
      .filter((r) => !r.metadata?.admitted_at)
      .map((r) => ({
        id: r.id,
        metadata: { ...(r.metadata || {}), admitted_at: now },
      }));
    // supabase doesn't have a bulk JSONB merge, so update individually · small lists
    await Promise.all(
      updates.map((u) =>
        admin.from('participants').update({ metadata: u.metadata }).eq('id', u.id)
      )
    );
    return NextResponse.json({ ok: true, admitted: updates.length });
  }

  const { data: existing } = await admin
    .from('participants')
    .select('id, metadata')
    .eq('id', participantId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (!existing) return new NextResponse('participant not found', { status: 404 });
  const metadata = { ...(existing.metadata || {}), admitted_at: now };
  const { error } = await admin
    .from('participants')
    .update({ metadata })
    .eq('id', existing.id);
  if (error) {
    console.error('[admit] update failed', error);
    return new NextResponse('could not admit', { status: 500 });
  }
  return NextResponse.json({ ok: true, admitted: 1 });
}
