import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// DELETE /api/host/people  body: { profileId } OR { participantId }
//
// "right to be forgotten" style delete · permanently removes a person from the
// dataset. with a profileId we delete every participant row tied to that profile
// (cascades captures) and then the profile itself. with just a participantId
// (someone who joined before profiles existed, or with no email match) we delete
// only that participant row (which cascades captures off them).
//
// host-only · approved hosts have access to every profile because all sessions
// share the WAFG host pool.
export async function DELETE(request) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let profileId = null;
  let participantId = null;
  try {
    const body = await request.json();
    if (body?.profileId) profileId = validateUuid(body.profileId, 'profile id');
    if (body?.participantId) participantId = validateUuid(body.participantId, 'participant id');
    if (!profileId && !participantId) {
      return new NextResponse('profileId or participantId required', { status: 400 });
    }
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();

  if (profileId) {
    // delete participant rows FIRST · the FK on participants.profile_id is
    // ON DELETE SET NULL so if we deleted the profile first we'd be left with
    // orphan participant rows holding the person's name in past sessions.
    const { error: pErr } = await admin
      .from('participants')
      .delete()
      .eq('profile_id', profileId);
    if (pErr) {
      console.error('[host/people] delete participants failed', pErr);
      return new NextResponse('could not delete participant records', { status: 500 });
    }
    const { error: prErr } = await admin
      .from('profiles')
      .delete()
      .eq('id', profileId);
    if (prErr) {
      console.error('[host/people] delete profile failed', prErr);
      return new NextResponse('could not delete profile', { status: 500 });
    }
    return NextResponse.json({ ok: true, deleted: 'profile' });
  }

  // participantId-only path · no profile to remove
  const { error: pErr } = await admin
    .from('participants')
    .delete()
    .eq('id', participantId);
  if (pErr) {
    console.error('[host/people] delete participant failed', pErr);
    return new NextResponse('could not delete participant', { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted: 'participant' });
}
