import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import {
  validateParticipantName,
  validateUuid,
  validateEmail,
  validateLinkedinUrl,
  validateBoolean,
  ValidationError,
} from '@/lib/validate';
import { rateLimitByIp, getClientIp } from '@/lib/rate-limit';
import {
  signParticipantToken,
  PARTICIPANT_COOKIE_NAME,
  PARTICIPANT_COOKIE_OPTIONS,
} from '@/lib/participant-token';
import {
  signProfileToken,
  PROFILE_COOKIE_NAME,
  PROFILE_COOKIE_OPTIONS,
} from '@/lib/profile-cookie';
import { addSubscriberToKit } from '@/lib/kit';

// POST /api/sessions/:id/join
// body: { name, email, linkedinUrl?, newsletterOptIn }
// creates or updates the participant's profile (keyed by email), creates the
// session-specific participant row, sets HttpOnly cookies for both identity
// (8h) and profile recognition (6mo). syncs the email to Kit when opt-in is true.
export async function POST(request, { params }) {
  const allowed = await rateLimitByIp(request, 'join', { limit: 10, windowSeconds: 60 });
  if (!allowed) return new NextResponse('too many join attempts · slow down for a minute', { status: 429 });

  let sessionId, name, email, linkedinUrl, newsletterOptIn;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    name = validateParticipantName(body?.name);
    email = validateEmail(body?.email);
    linkedinUrl = validateLinkedinUrl(body?.linkedinUrl);
    newsletterOptIn = validateBoolean(body?.newsletterOptIn ?? true, 'newsletterOptIn');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, status')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('session not found', { status: 404 });
  if (session.status === 'ended') return new NextResponse('this session already ended', { status: 400 });

  // session capacity check
  const { count } = await admin
    .from('participants')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if ((count || 0) >= 60) {
    return new NextResponse('this session is full', { status: 403 });
  }

  // upsert profile by email
  const now = new Date().toISOString();
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id, kit_synced_at')
    .eq('email', email)
    .maybeSingle();

  let profileId;
  if (existingProfile) {
    profileId = existingProfile.id;
    await admin
      .from('profiles')
      .update({
        display_name: name,
        linkedin_url: linkedinUrl,
        newsletter_opt_in: newsletterOptIn,
        updated_at: now,
      })
      .eq('id', profileId);
  } else {
    const { data: created, error: createErr } = await admin
      .from('profiles')
      .insert({
        email,
        display_name: name,
        linkedin_url: linkedinUrl,
        newsletter_opt_in: newsletterOptIn,
      })
      .select('id')
      .single();
    if (createErr) {
      console.error('profile create error', createErr);
      return new NextResponse('could not create profile', { status: 500 });
    }
    profileId = created.id;
  }

  // create the session-specific participant row
  const { data: participant, error: pErr } = await admin
    .from('participants')
    .insert({
      session_id: session.id,
      profile_id: profileId,
      name,
      is_present: true,
      metadata: { join_ip: getClientIp(request) },
    })
    .select('id')
    .single();
  if (pErr) {
    console.error('participant create error', pErr);
    return new NextResponse('could not join session', { status: 500 });
  }

  // sync to Kit if opted in (fire-and-forget; don't block the join on Kit availability)
  if (newsletterOptIn && (!existingProfile || !existingProfile.kit_synced_at)) {
    addSubscriberToKit({ email, firstName: name.split(' ')[0] })
      .then(async (r) => {
        if (r.ok) {
          await admin.from('profiles').update({ kit_synced_at: now }).eq('id', profileId);
        }
      })
      .catch(() => {});
  }

  // sign cookies and respond
  const participantToken = signParticipantToken({ sessionId: session.id, participantId: participant.id });
  const profileToken = signProfileToken({ profileId });
  const response = NextResponse.json({ participantId: participant.id });
  response.cookies.set(PARTICIPANT_COOKIE_NAME, participantToken, PARTICIPANT_COOKIE_OPTIONS);
  response.cookies.set(PROFILE_COOKIE_NAME, profileToken, PROFILE_COOKIE_OPTIONS);
  return response;
}
