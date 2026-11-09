import { redirect } from 'next/navigation';
import { adminClient } from '@/lib/supabase-server';
import { INVITE_CODE_RE } from '@/lib/referral';
import { pickNextSession } from '@/lib/next-session';
import { joinWindow } from '@/lib/join-window';
import { etWhen } from '@/lib/invite-image';
import { validateUuid } from '@/lib/validate';
import InviteLanding from '@/components/InviteLanding';

export const dynamic = 'force-dynamic';
const SITE = 'https://goodchats.weareforgood.com';

// a member's personal invite link: /i/<code>[?m=<round id>]
// shows who invited you, the next call, the question they chose to share (if any) and a one-step
// way in. an unknown or retired code just goes to the homepage.
async function load(code, m) {
  if (!INVITE_CODE_RE.test(code)) return null;
  const admin = adminClient();
  const { data: inviter } = await admin.from('profiles').select('id, display_name').eq('invite_code', code).maybeSingle();
  if (!inviter) return null;
  const first = String(inviter.display_name || '').trim().split(/\s+/)[0] || 'A friend';

  const { data: rows } = await admin
    .from('sessions').select('id, code, name, status, metadata, created_at, rounds_total, round_seconds').neq('status', 'ended');
  const chosen = pickNextSession(rows || []).chosen;
  let next = null;
  if (chosen) {
    const startsAt = chosen.metadata?.starts_at || null;
    const win = joinWindow(startsAt);
    const live = chosen.status === 'live' || chosen.status === 'running_round' || chosen.status === 'closing';
    const roundsMin = Math.round(((chosen.rounds_total || 0) * (chosen.round_seconds || 0)) / 60);
    next = { id: chosen.id, code: chosen.code, name: chosen.name, startsAt, canJoinNow: live || !win.gated || win.open, durationMin: Math.max(30, roundsMin + 10) };
  }

  let prompt = null;
  if (m) {
    try {
      const { data: r } = await admin.from('rounds').select('prompt_text').eq('id', validateUuid(m, 'round')).maybeSingle();
      const t = String(r?.prompt_text || '').trim();
      prompt = t ? t.slice(0, 200) : null;
    } catch {}
  }
  return { first, next, prompt };
}

export async function generateMetadata({ params, searchParams }) {
  const m = typeof searchParams?.m === 'string' ? searchParams.m : '';
  const d = await load(params.code, m).catch(() => null);
  const title = d ? `${d.first} invited you to Good Chats` : 'Good Chats · We Are For Good';
  const when = d?.next ? etWhen(d.next.startsAt) : null;
  const description = d?.prompt
    ? `"${d.prompt}" Answer it live, one-on-one, with someone new.${when ? ` Next call: ${when}.` : ''}`
    : `Six one-on-one conversations in about 45 minutes, with people doing good.${when ? ` Next call: ${when}.` : ''}`;
  const image = `${SITE}/api/invite-image?code=${encodeURIComponent(params.code)}${m ? `&m=${encodeURIComponent(m)}` : ''}`;
  return {
    title,
    description,
    robots: { index: false, follow: false }, // personal links shouldn't be indexed by search engines
    openGraph: { title, description, url: `${SITE}/i/${params.code}`, siteName: 'Good Chats', images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function InvitePage({ params, searchParams }) {
  const m = typeof searchParams?.m === 'string' ? searchParams.m : '';
  const d = await load(params.code, m).catch(() => null);
  if (!d) redirect('/');
  return <InviteLanding code={params.code} first={d.first} next={d.next} prompt={d.prompt} />;
}
