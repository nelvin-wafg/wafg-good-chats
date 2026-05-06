import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/leave
// called when a participant closes their tab or navigates away.
// marks them as not present so they're excluded from future pairings.
// no-op if cookie is missing/expired (idempotent).
export async function POST(_request, { params }) {
  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  if (!me) return NextResponse.json({ ok: true }); // nothing to do

  const admin = adminClient();
  await admin
    .from('participants')
    .update({
      is_present: false,
      left_at: new Date().toISOString(),
      current_room_name: null,
    })
    .eq('id', me.participantId)
    .eq('session_id', sessionId);

  return NextResponse.json({ ok: true });
}
