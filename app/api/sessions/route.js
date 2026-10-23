import { NextResponse } from 'next/server';
import { createClient, adminClient } from '@/lib/supabase-server';
import { createRoom } from '@/lib/daily';
import { logAuditEvent } from '@/lib/audit';
import { notifyPendingSignups } from '@/lib/notify';
import {
  validateSessionName,
  validateCode,
  validateRounds,
  validateRoundSeconds,
  validatePrompts,
  ValidationError,
} from '@/lib/validate';

// the announcement blast is paced (resend rate limit) so a big list can take a while
export const maxDuration = 60;

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
  let name, code, roundsTotal, roundSeconds, prompts, startNow, isPublished, startsAt, notifyList;
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
    // notify_list: a SEPARATE, explicit, default-false opt-in from is_published.
    // is_published defaults true on every session (including throwaway test
    // sessions) — tying an email blast to that would spam real subscribers
    // every time a test session gets created, so this only fires the
    // announcement when the host deliberately checks it.
    notifyList = body?.notify_list === true;
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  // notify_list fires at creation. notify_sent_at is stamped only AFTER the emails
  // actually went out (below): it used to be stamped up front, so a send that never
  // ran still left the session marked "already sent" and it could never retry.

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
      metadata: { is_published: isPublished, starts_at: startsAt, notify_list: notifyList, notify_sent_at: null },
    })
    .select('id, code')
    .single();

  if (error) {
    if (error.code === '23505') {
      return new NextResponse('that code is already in use · pick a different slug', { status: 409 });
    }
    return new NextResponse('could not create session', { status: 500 });
  }

  // wait for the sends: a serverless function can be frozen as soon as it replies,
  // which silently dropped the emails when this was fire-and-forget.
  let notify = null;
  if (notifyList) {
    try {
      notify = await notifyPendingSignups({ sessionName: name, sessionCode: code, startsAt });
      // mark as announced only if nobody was waiting, or at least some went out, and
      // there isn't a backlog left over. otherwise leave it open so saving again retries.
      const done = (notify.attempted === 0 || notify.sent > 0) && !notify.more;
      if (done) {
        await admin
          .from('sessions')
          .update({ metadata: { is_published: isPublished, starts_at: startsAt, notify_list: true, notify_sent_at: new Date().toISOString() } })
          .eq('id', data.id);
      }
    } catch (e) {
      console.error('[notify] announcement blast failed', e?.message || e);
      notify = { error: true };
    }
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

  return NextResponse.json({ id: data.id, code: data.code, notify });
}
