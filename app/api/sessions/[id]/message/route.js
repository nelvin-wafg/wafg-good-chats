import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/message  body: { participantId, text }
// host → single participant private message. shown as a toast/banner on the
// recipient's screen via the state poll. sending also clears that participant's
// flag (the host has responded).
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, participantId, text;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    participantId = validateUuid(body?.participantId, 'participant id');
    text = String(body?.text || '').trim();
    if (!text) return new NextResponse('message text required', { status: 400 });
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
  const { flag_at, ...rest } = prev; // host responded → clear the flag
  const metadata = {
    ...rest,
    host_message: { text, at: new Date().toISOString() },
  };

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
