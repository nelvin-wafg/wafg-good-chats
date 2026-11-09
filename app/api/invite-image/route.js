import { ImageResponse } from 'next/og';
import { adminClient } from '@/lib/supabase-server';
import { INVITE_CODE_RE } from '@/lib/referral';
import { pickNextSession } from '@/lib/next-session';
import { inviteImageElement, etWhen } from '@/lib/invite-image';
import { validateUuid } from '@/lib/validate';

export const dynamic = 'force-dynamic';

// GET /api/invite-image?code=<invite code>&m=<round id>&format=wide|square
// the picture behind a personal invite link. public (it only ever shows the inviter's first
// name, the next call and a host-written question), and it always renders SOMETHING, so a
// pasted link never shows a broken preview.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const m = url.searchParams.get('m') || '';
  const square = url.searchParams.get('format') === 'square';
  const size = square ? { width: 1080, height: 1080 } : { width: 1200, height: 630 };

  let first = null, when = null, prompt = null;
  try {
    const admin = adminClient();
    if (INVITE_CODE_RE.test(code)) {
      const { data: p } = await admin.from('profiles').select('display_name').eq('invite_code', code).maybeSingle();
      first = p ? String(p.display_name || '').trim().split(/\s+/)[0] || null : null;
    }
    const { data: rows } = await admin
      .from('sessions').select('id, code, name, status, metadata, created_at').neq('status', 'ended');
    const next = pickNextSession(rows || []).chosen;
    when = next ? etWhen(next.metadata?.starts_at) : null;
    if (m) {
      try {
        const rid = validateUuid(m, 'round');
        const { data: r } = await admin.from('rounds').select('prompt_text').eq('id', rid).maybeSingle();
        const t = String(r?.prompt_text || '').trim();
        prompt = t ? t.slice(0, 140) : null;
      } catch {}
    }
  } catch {}

  const res = new ImageResponse(inviteImageElement({ first, when, prompt, size }), size);
  res.headers.set('Cache-Control', 'public, max-age=600, s-maxage=600');
  return res;
}
