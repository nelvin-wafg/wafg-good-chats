import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { validateUuid, ValidationError } from '@/lib/validate';
import { rateLimitByIp } from '@/lib/rate-limit';

// POST /api/sessions/:id/flag
// participant-initiated · raises a "need help" flag for the host to see.
// stored on participants.metadata.flag_at; host's state poll surfaces it and
// plays a soft chime + shows a badge next to the participant's name.
export async function POST(request, { params }) {
  const ok = await rateLimitByIp(request, 'flag', { limit: 5, windowSeconds: 30 });
  if (!ok) return new NextResponse('too many flags · slow down a sec', { status: 429 });

  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  // optional text body · participant can include a short note with their flag
  // so the host knows what they need without having to ask.
  let text = null;
  try {
    const body = await request.json().catch(() => null);
    if (body?.text) {
      text = String(body.text).trim().slice(0, 500);
      if (!text) text = null;
    }
  } catch {}

  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  if (!me?.participantId) return new NextResponse('not joined', { status: 401 });

  const admin = adminClient();
  // preserve other metadata keys
  const { data: existing } = await admin
    .from('participants')
    .select('metadata')
    .eq('id', me.participantId)
    .maybeSingle();
  const metadata = {
    ...(existing?.metadata || {}),
    flag_at: new Date().toISOString(),
    flag_text: text || null,
  };

  const { error } = await admin
    .from('participants')
    .update({ metadata })
    .eq('id', me.participantId);
  if (error) {
    console.error('[flag] update failed', error);
    return new NextResponse('could not flag', { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
