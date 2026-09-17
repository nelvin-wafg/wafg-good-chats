import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/message  body: { participantId, text? }
// host → single participant private message. shown as a toast/banner on the
// recipient's screen via the state poll. sending also clears that participant's
// flag (the host has responded).
//
// an empty/omitted `text` means "mark as handled" with no message sent — a flag
// that was accidental, already resolved verbally, or just acknowledged shouldn't
// force the host to type something to make the pulsing badge go away. this is
// the only way to clear flag_text.flag_at other than replying, since it's never
// cleared by any other path.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, participantId, text;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    participantId = validateUuid(body?.participantId, 'participant id');
    text = String(body?.text || '').trim();
    if (text.length > 500) text = text.slice(0, 500);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: existing } = await admin
    .from('participants')
    .select('metadata')
    .eq('id', participantId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (!existing) return new NextResponse('participant not found', { status: 404 });

  const prev = existing.metadata || {};
  const { flag_at, flag_text, ...rest } = prev; // host responded/acknowledged → clear the flag
  const metadata = text
    ? { ...rest, host_message: { text, at: new Date().toISOString() } }
    : rest;

  const { error } = await admin
    .from('participants')
    .update({ metadata })
    .eq('id', participantId);
  if (error) {
    console.error('[message] update failed', error);
    return new NextResponse('could not send', { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
