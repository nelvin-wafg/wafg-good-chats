import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { deleteRoom, createRoom } from '@/lib/daily';
import {
  validateSessionName,
  validateCode,
  validateRounds,
  validateRoundSeconds,
  validatePrompts,
  ValidationError,
} from '@/lib/validate';

// PATCH /api/sessions/:id  — update a draft's config. optionally go live (start_now).
// only draft or pre-round (live, no rounds started) sessions can be edited.
export async function PATCH(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('not an approved host', { status: 403 });

  let name, code, roundsTotal, roundSeconds, prompts, startNow, isPublished, startsAt, hasPublishedKey, hasStartsAtKey;
  try {
    const body = await request.json();
    name = validateSessionName(body?.name);
    code = validateCode(body?.code);
    roundsTotal = validateRounds(body?.rounds_total);
    roundSeconds = validateRoundSeconds(body?.round_seconds);
    prompts = validatePrompts(body?.prompts);
    startNow = Boolean(body?.start_now);
    // only overwrite the metadata keys the body sends · leaves other keys
    // (broadcast, etc.) intact.
    hasPublishedKey = Object.prototype.hasOwnProperty.call(body || {}, 'is_published');
    hasStartsAtKey = Object.prototype.hasOwnProperty.call(body || {}, 'starts_at');
    isPublished = hasPublishedKey ? Boolean(body.is_published) : undefined;
    if (hasStartsAtKey) {
      if (!body.starts_at) {
        startsAt = null;
      } else {
        const ts = new Date(body.starts_at);
        startsAt = Number.isNaN(ts.getTime()) ? null : ts.toISOString();
      }
    }
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, status, main_room_name, metadata')
    .eq('id', params.id)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });
  if (session.status !== 'draft' && session.status !== 'live') {
    return new NextResponse('this session has already started · can only edit drafts', { status: 400 });
  }

  // merge metadata so we don't clobber broadcast / other server-side keys
  const newMetadata = { ...(session.metadata || {}) };
  if (hasPublishedKey) newMetadata.is_published = isPublished;
  if (hasStartsAtKey) newMetadata.starts_at = startsAt;

  const updates = {
    name,
    code,
    rounds_total: roundsTotal,
    round_seconds: roundSeconds,
    prompts,
    metadata: newMetadata,
  };

  // going live from a draft · provision the daily room
  if (startNow && session.status === 'draft') {
    try {
      const room = await createRoom({
        name: `wafg-main-${code}-${Date.now().toString(36)}`,
        expMinutes: Math.max(120, (roundsTotal + 2) * Math.ceil(roundSeconds / 60) + 30),
        isMain: true,
      });
      updates.status = 'live';
      updates.main_room_name = room.name;
    } catch (e) {
      console.error('failed to provision daily room on draft go-live', e);
    }
  }

  const { error } = await admin.from('sessions').update(updates).eq('id', session.id);
  if (error) {
    if (error.code === '23505') {
      return new NextResponse('that code is already in use · pick a different slug', { status: 409 });
    }
    return new NextResponse('could not update session', { status: 500 });
  }
  return NextResponse.json({ id: session.id });
}

// DELETE /api/sessions/:id  — any approved host can delete a session.
// hard delete · cascades to remove participants, pairings, rounds, captures.
// also cleans up any active daily.co rooms.
export async function DELETE(_request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, host_id, main_room_name')
    .eq('id', params.id)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });

  // delete is destructive · only the primary host (creator) can do it.
  // co-hosts can manage the session live but can't permanently destroy data.
  if (session.host_id !== auth.user.id) {
    return new NextResponse('only the primary host can delete this session', { status: 403 });
  }

  // best-effort daily room cleanup (don't block delete on these)
  if (session.main_room_name) {
    try { await deleteRoom(session.main_room_name); } catch {}
  }
  const { data: pairings = [] } = await admin
    .from('pairings')
    .select('room_name')
    .eq('session_id', session.id);
  await Promise.all(
    pairings
      .filter((p) => p.room_name)
      .map((p) => deleteRoom(p.room_name).catch(() => {}))
  );

  // hard delete · cascades to participants/pairings/rounds/captures
  const { error } = await admin.from('sessions').delete().eq('id', session.id);
  if (error) return new NextResponse(error.message, { status: 500 });
  return NextResponse.json({ ok: true });
}
