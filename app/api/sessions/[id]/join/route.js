import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { validateParticipantName, validateUuid, ValidationError } from '@/lib/validate';
import { rateLimitByIp, getClientIp } from '@/lib/rate-limit';
import {
  signParticipantToken,
  PARTICIPANT_COOKIE_NAME,
  PARTICIPANT_COOKIE_OPTIONS,
} from '@/lib/participant-token';

// POST /api/sessions/:id/join  body: { name }  — participant joins (no auth)
// rate-limited per ip: max 10 joins per 60 seconds.
export async function POST(request, { params }) {
  // rate limit
  const allowed = await rateLimitByIp(request, 'join', { limit: 10, windowSeconds: 60 });
  if (!allowed) {
    return new NextResponse('too many join attempts · slow down for a minute', { status: 429 });
  }

  // validate inputs
  let name;
  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    name = validateParticipantName(body?.name);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .single();
  if (!session) return new NextResponse('session not found', { status: 404 });
  if (session.status === 'ended') return new NextResponse('this session already ended', { status: 400 });

  // limit per-session participants (defense against spam joins)
  const { count } = await admin
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if ((count || 0) >= 60) {
    return new NextResponse('this session is full', { status: 403 });
  }

  const { data, error } = await admin
    .from('participants')
    .insert({
      session_id: session.id,
      name,
      is_present: true,
      metadata: { join_ip: getClientIp(request) },
    })
    .select('id')
    .single();

  if (error) return new NextResponse('could not join session', { status: 500 });

  // sign + set the identity cookie (HttpOnly, server-only source of truth)
  const token = signParticipantToken({ sessionId: session.id, participantId: data.id });
  const response = NextResponse.json({ participantId: data.id });
  response.cookies.set(PARTICIPANT_COOKIE_NAME, token, PARTICIPANT_COOKIE_OPTIONS);
  return response;
}
