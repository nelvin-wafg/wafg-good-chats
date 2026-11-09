import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getTrustedProfileId } from '@/lib/profile-trust';
import { rateLimitByIp } from '@/lib/rate-limit';
import { newInviteCode, isMissingSchema } from '@/lib/referral';

export const dynamic = 'force-dynamic';
const SITE = 'https://goodchats.weareforgood.com';

// POST /api/profiles/invite  body: { action: 'ensure' | 'regenerate' }
// the member's personal invite link and the referral tracker behind it. 'ensure' makes a link the
// first time and returns the same one after; 'regenerate' kills the old link (anyone holding it
// gets the generic page) and makes a new one. past credit stays: it is stored on the people who joined.
export async function POST(request) {
  if (!(await rateLimitByIp(request, 'profile-invite', { limit: 20, windowSeconds: 60 }))) {
    return new NextResponse('too many tries · give it a minute', { status: 429 });
  }
  const profileId = getTrustedProfileId(cookies());
  if (!profileId) return new NextResponse('unauthorized', { status: 401 });

  let action = 'ensure';
  try { action = (await request.json())?.action === 'regenerate' ? 'regenerate' : 'ensure'; } catch {}

  const admin = adminClient();
  const { data: profile, error } = await admin.from('profiles').select('id, invite_code').eq('id', profileId).maybeSingle();
  if (error) {
    if (isMissingSchema(error)) return new NextResponse('invites are not switched on yet', { status: 503 });
    return new NextResponse("couldn't load your invite link", { status: 500 });
  }
  if (!profile) return new NextResponse('profile not found', { status: 404 });

  let code = profile.invite_code;
  if (!code || action === 'regenerate') {
    // a collision on the unique column is astronomically unlikely, but retry a few times anyway
    for (let i = 0; i < 5 && (!code || action === 'regenerate'); i++) {
      const candidate = newInviteCode();
      const { error: upErr } = await admin.from('profiles').update({ invite_code: candidate }).eq('id', profileId);
      if (!upErr) { code = candidate; action = 'ensure'; }
    }
    if (!code || code === profile.invite_code && action === 'regenerate') {
      return new NextResponse("couldn't make an invite link · try again", { status: 500 });
    }
  }

  // the tracker: opened it, showed interest (signed up or saved a spot), joined their first call
  const [{ data: events }, { data: brought }] = await Promise.all([
    admin.from('referral_events').select('event, visitor_key').eq('referrer_id', profileId),
    admin.from('profiles').select('display_name, created_at').eq('referred_by', profileId).order('created_at', { ascending: true }),
  ]);
  const rows = events || [];
  const visits = rows.filter((e) => e.event === 'visit').length;
  const interested = new Set(rows.filter((e) => e.event === 'signup' || e.event === 'rsvp').map((e) => e.visitor_key)).size;
  const joined = (brought || []).map((b) => ({ firstName: String(b.display_name || '').trim().split(/\s+/)[0] || 'someone' }));

  return NextResponse.json({
    code,
    url: `${SITE}/i/${code}`,
    stats: { visits, interested, joined: joined.length },
    joined,
  });
}
