import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { rateLimitByIp } from '@/lib/rate-limit';
import {
  validateParticipantName,
  validateLinkedinUrl,
  validateUuid,
  ValidationError,
} from '@/lib/validate';

// PATCH /api/profiles/me  body: { sessionId, name, linkedinUrl }
// participant-initiated profile edit from inside the room. authenticated by the
// participant identity cookie · the cookie carries sessionId + participantId so
// nobody can edit another person's profile.
//
// updates BOTH the shared profile (so the saved record + future sessions reflect
// the change) AND the current session's participant row (so this session's name
// in lists/pairings updates immediately).
export async function PATCH(request) {
  const allowed = await rateLimitByIp(request, 'profiles-me', { limit: 10, windowSeconds: 300 });
  if (!allowed) return new NextResponse('too many requests', { status: 429 });

  let sessionId, name, linkedinUrl;
  try {
    const body = await request.json();
    sessionId = validateUuid(body?.sessionId, 'session id');
    name = validateParticipantName(body?.name);
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const cookieStore = cookies();
  const me = getParticipantFromCookies(cookieStore, sessionId);
  if (!me?.participantId) return new NextResponse('unauthorized', { status: 401 });

  const admin = adminClient();

  // look up the participant + their linked profile
  const { data: participant } = await admin
    .from('participants')
    .select('id, profile_id')
    .eq('id', me.participantId)
    .eq('session_id', sessionId)
    .maybeSingle();
  if (!participant) return new NextResponse('participant not found', { status: 404 });

  const now = new Date().toISOString();

  // update the shared profile (if one is linked)
  if (participant.profile_id) {
    await admin
      .from('profiles')
      .update({
        display_name: name,
        linkedin_url: linkedinUrl,
        updated_at: now,
      })
      .eq('id', participant.profile_id);
  }

  // update the per-session participant row so the current session reflects it
  await admin
    .from('participants')
    .update({ name })
    .eq('id', participant.id);

  return NextResponse.json({ ok: true, name, linkedinUrl });
}
