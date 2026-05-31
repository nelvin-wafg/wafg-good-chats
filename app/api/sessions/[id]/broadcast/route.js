import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { validateUuid, ValidationError } from '@/lib/validate';

// POST /api/sessions/:id/broadcast  body: { text }
// host → everyone gentle banner. stored on session.metadata.broadcast; the
// state poll surfaces it to every participant who's polled within ~15s of send.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('forbidden', { status: 403 });

  let sessionId, text;
  try {
    sessionId = validateUuid(params.id, 'session id');
    const body = await request.json();
    text = String(body?.text || '').trim();
    if (!text) return new NextResponse('broadcast text required', { status: 400 });
    if (text.length > 200) text = text.slice(0, 200);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: existing } = await admin
    .from('sessions')
    .select('metadata')
    .eq('id', sessionId)
    .maybeSingle();
  if (!existing) return new NextResponse('session not found', { status: 404 });

  const prev = existing.metadata || {};
  const metadata = {
    ...prev,
    broadcast: { text, at: new Date().toISOString() },
  };

  const { error } = await admin
    .from('sessions')
    .update({ metadata })
    .eq('id', sessionId);
  if (error) {
    console.error('[broadcast] update failed', error);
    return new NextResponse('could not broadcast', { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
