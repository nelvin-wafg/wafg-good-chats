import { NextResponse } from 'next/server';
import { createClient, adminClient } from '@/lib/supabase-server';
import {
  validateSessionName,
  validateCode,
  validateRounds,
  validateRoundSeconds,
  validatePrompts,
  ValidationError,
} from '@/lib/validate';

// POST /api/sessions  — host creates a new session
export async function POST(request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new NextResponse('not authenticated', { status: 401 });

  // confirm the host is approved (middleware already does this for /host/* pages,
  // but API routes bypass that — so re-check)
  const admin = adminClient();
  const { data: host } = await admin
    .from('hosts')
    .select('is_approved')
    .eq('id', user.id)
    .single();
  if (!host?.is_approved) return new NextResponse('host not approved', { status: 403 });

  // validate inputs
  let name, code, roundsTotal, roundSeconds, prompts, startNow;
  try {
    const body = await request.json();
    name = validateSessionName(body?.name);
    code = validateCode(body?.code);
    roundsTotal = validateRounds(body?.rounds_total);
    roundSeconds = validateRoundSeconds(body?.round_seconds);
    prompts = validatePrompts(body?.prompts);
    startNow = Boolean(body?.start_now);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const status = startNow ? 'live' : 'draft';
  const { data, error } = await admin
    .from('sessions')
    .insert({
      name,
      code,
      host_id: user.id,
      rounds_total: roundsTotal,
      round_seconds: roundSeconds,
      prompts,
      status,
    })
    .select('id, code')
    .single();

  if (error) {
    if (error.code === '23505') {
      // unique constraint violation on code
      return new NextResponse('that code is already in use · pick a different slug', { status: 409 });
    }
    return new NextResponse('could not create session', { status: 500 });
  }
  return NextResponse.json({ id: data.id, code: data.code });
}
