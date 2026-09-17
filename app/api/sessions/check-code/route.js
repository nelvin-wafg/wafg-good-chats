import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateCode, ValidationError } from '@/lib/validate';

// GET /api/sessions/check-code?code=some-slug&excludeId=<uuid>
// lets the new-session wizard debounce-check slug availability as the host
// types it, instead of only finding out about a collision after walking the
// whole 3-step wizard and submitting. excludeId lets the edit flow check
// against everyone ELSE's code without flagging a session's own current code.
export async function GET(request) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  const url = new URL(request.url);
  let code;
  try {
    code = validateCode(url.searchParams.get('code'));
  } catch (err) {
    if (err instanceof ValidationError) return NextResponse.json({ available: false, reason: err.message });
    return new NextResponse('bad request', { status: 400 });
  }
  const excludeId = url.searchParams.get('excludeId');

  const admin = adminClient();
  let query = admin.from('sessions').select('id').eq('code', code);
  if (excludeId) query = query.neq('id', excludeId);
  const { data } = await query.maybeSingle();

  return NextResponse.json({ available: !data });
}
