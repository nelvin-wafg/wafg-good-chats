import { NextResponse } from 'next/server';
import { createClient, adminClient } from '@/lib/supabase-server';
import { createRoom } from '@/lib/daily';
import { logAuditEvent } from '@/lib/audit';
import {
  validateSessionName,
  validateCode,
  validateRounds,
  validateRoundSeconds,
  validatePrompts,
  ValidationError,
} from '@/lib/validate';

// POST /api/sessions  — host creates a new session
export async function POST(request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('not authenticated', { status: 401 });

  // confirm the host is approved (middleware already does this for /host/* pages,
  // but API routes bypass that — so re-check)
  const admin = adminClient();
  const { data: host } = await admin
    .from('hosts')
    .select('is_approved, email, display_name')
    .eq('id', user.id)
    .single();
  if (!host?.is_approved) return new NextResponse('host not approved', { status: 403 });

  // validate inputs
  let name, code, roundsTotal, roundSeconds, prompts, startNow, isPublished, startsAt;
  try {
    const body = await request.json();
    name = validateSessionName(body?.name);
    code = validateCode(body?.code);
    roundsTotal = validateRounds(body?.rounds_total);
    roundSeconds = validateRoundSeconds(body?.round_seconds);
    prompts = validatePrompts(body?.prompts);
    startNow = Boolean(body?.start_now);
    // publish-to-landing-page metadata · lives on session.metadata so no
    // schema migration is needed. is_published defaults true (per the user's
    // pref). starts_at is optional · stored as ISO string if present.
    isPublished = body?.is_published === false ? false : true;
    startsAt = null;
    if (body?.starts_at) {
      const ts = new Date(body.starts_at);
      if (!Number.isNaN(ts.getTime())) startsAt = ts.toISOString();
    }
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  // always insert as draft first; if start_now, provision the daily room then flip to live.
  // doing it in two steps so the daily call doesn't block session creation if it fails.
  const { data, error } = await admin
    .from('sessions')
    .insert({
      name,
      code,
      host_id: user.id,
      rounds_total: roundsTotal,
      round_seconds: roundSeconds,
      prompts,
      status: 'draft',
      metadata: { is_published: isPublished, starts_at: startsAt },
    })
    .select('id, code')
    .single();

  if (error) {
    if (error.code === '23505') {
      return new NextResponse('that code is already in use · pick a different slug', { status: 409 });
    }
    return new NextResponse('could not create session', { status: 500 });
  }

  // if the host clicked "go live now *", provision the daily.co main room and flip status
  if (startNow) {
    try {
      const room = await createRoom({
        name: `wafg-main-${data.code}-${Date.now().toString(36)}`,
        expMinutes: Math.max(120, (roundsTotal + 2) * Math.ceil(roundSeconds / 60) + 30),
        isMain: true,
      });
      await admin
        .from('sessions')
        .update({ status: 'live', main_room_name: room.name })
        .eq('id', data.id);
    } catch (e) {
      // daily failed · leave the session as draft, host can retry by clicking "go live" in LiveControl
      console.error('failed to provision daily room on session create', e);
    }
  }

  logAuditEvent({
    eventType: 'session.created',
    actorId: user.id,
    actorLabel: host.display_name || host.email,
    sessionId: data.id,
    metadata: { code: data.code, startNow: Boolean(startNow) },
  });

  return NextResponse.json({ id: data.id, code: data.code });
}
