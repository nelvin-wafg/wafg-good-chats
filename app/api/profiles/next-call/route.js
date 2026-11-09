import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getTrustedProfileId } from '@/lib/profile-trust';
import { pickNextSession } from '@/lib/next-session';
import { joinWindow } from '@/lib/join-window';
import { isOnNotifyList } from '@/lib/profile-notify';

export const dynamic = 'force-dynamic';
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0' };

// GET /api/profiles/next-call
// the profile page's "next call" card. same choice of session as the homepage (lib/next-session),
// plus what THIS person needs to act: have they saved a spot, are the doors open, are they on the
// notify list (for when nothing is scheduled). nothing here is secret about the session; it is
// behind the profile cookie only because it reads the person's own email.
export async function GET() {
  const profileId = getTrustedProfileId(cookies());
  if (!profileId) return new NextResponse('Unauthorized', { status: 401 });

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id, email').eq('id', profileId).maybeSingle();
  if (!profile) return new NextResponse('Profile not found', { status: 404 });

  const now = Date.now();
  const { data: rows } = await admin
    .from('sessions')
    .select('id, code, name, status, metadata, created_at, rounds_total, round_seconds')
    .neq('status', 'ended')
    .order('created_at', { ascending: false });
  const { chosen } = pickNextSession(rows || [], now);

  let onNotifyList = false;
  try { onNotifyList = await isOnNotifyList(admin, profile.email); } catch {}

  if (!chosen) {
    return NextResponse.json({ next: null, onNotifyList, serverNow: now }, { headers: NO_STORE });
  }

  let saved = false;
  try {
    const { data: rsvp } = await admin
      .from('session_rsvps')
      .select('id')
      .eq('session_id', chosen.id)
      .eq('email', profile.email)
      .limit(1);
    saved = (rsvp || []).length > 0;
  } catch {}

  const startsAt = chosen.metadata?.starts_at || null;
  const win = joinWindow(startsAt, now);
  const isLive = chosen.status === 'live' || chosen.status === 'running_round' || chosen.status === 'closing';
  const roundsMin = Math.round(((chosen.rounds_total || 0) * (chosen.round_seconds || 0)) / 60);

  return NextResponse.json(
    {
      next: {
        id: chosen.id,
        code: chosen.code,
        name: chosen.name,
        status: chosen.status,
        startsAt,
        doorsOpenAt: win.gated ? new Date(win.opensAtMs).toISOString() : null,
        // true once someone can actually walk in: the room is live, or the doors time has passed,
        // or the host never set a start time
        canJoinNow: isLive || !win.gated || win.open,
        durationMin: Math.max(30, roundsMin + 10),
      },
      saved,
      onNotifyList,
      serverNow: now,
    },
    { headers: NO_STORE }
  );
}
