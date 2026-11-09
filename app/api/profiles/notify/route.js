import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getTrustedProfileId } from '@/lib/profile-trust';
import { rateLimitByIp } from '@/lib/rate-limit';
import { joinNotifyList, leaveNotifyList, isOnNotifyList } from '@/lib/profile-notify';

export const dynamic = 'force-dynamic';

// POST /api/profiles/notify  body: { on: boolean }
// the profile page's "tell me when the next call is scheduled" switch. acts only on the signed-in
// profile's own email, never one typed in the request.
export async function POST(request) {
  if (!(await rateLimitByIp(request, 'profile-notify', { limit: 20, windowSeconds: 60 }))) {
    return new NextResponse('Too many tries · give it a minute', { status: 429 });
  }
  const profileId = getTrustedProfileId(cookies());
  if (!profileId) return new NextResponse('Unauthorized', { status: 401 });

  let on;
  try {
    on = (await request.json())?.on === true;
  } catch {
    return new NextResponse('Bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('email, display_name').eq('id', profileId).maybeSingle();
  if (!profile) return new NextResponse('Profile not found', { status: 404 });

  try {
    if (on) await joinNotifyList(admin, { email: profile.email, firstName: (profile.display_name || '').split(' ')[0], source: 'profile' });
    else await leaveNotifyList(admin, profile.email, 'profile');
    return NextResponse.json({ ok: true, onNotifyList: await isOnNotifyList(admin, profile.email) });
  } catch (e) {
    console.error('[profile-notify] failed', e?.message || e);
    return new NextResponse("Couldn't update that · try again", { status: 500 });
  }
}
