import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { getParticipantFromCookies } from '@/lib/participant-token';
import { validateUuid, ValidationError } from '@/lib/validate';

// GET /api/sessions/:id/recap
// returns recap data tailored to the caller:
//   - host of the session: full recap (all participants, all pairings, all captures)
//   - participant (cookie): personal recap (who they captured, who captured them, prompts, partner names)
//   - anyone else: 401
export async function GET(_request, { params }) {
  let sessionId;
  try {
    sessionId = validateUuid(params.id, 'session id');
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('id, code, name, status, rounds_total, host_id, prompts, ended_at, created_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return new NextResponse('not found', { status: 404 });

  // identify caller: any approved host OR participant (cookie)
  let role = null;
  let participantId = null;

  // try host auth (any approved host has full recap access)
  const hostAuth = await getApprovedHost();
  if (hostAuth) {
    role = 'host';
  }

  // fall back to participant cookie
  if (!role) {
    const cookieStore = cookies();
    const me = getParticipantFromCookies(cookieStore, sessionId);
    if (me) {
      role = 'participant';
      participantId = me.participantId;
    }
  }

  if (!role) return new NextResponse('not authenticated', { status: 401 });

  if (role === 'host') {
    // full host recap
    const [{ data: participants }, { data: captures }, { data: rounds }] = await Promise.all([
      admin.from('participants')
        .select('id, name, joined_at, left_at, profiles(email, linkedin_url)')
        .eq('session_id', sessionId)
        .order('joined_at', { ascending: true }),
      admin.from('captures')
        .select('id, capturer_id, captured_id, captured_name, captured_email, captured_linkedin_url, created_at')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true }),
      admin.from('rounds')
        .select('round_number, prompt_text, started_at, ended_at')
        .eq('session_id', sessionId)
        .order('round_number', { ascending: true }),
    ]);
    const idToName = Object.fromEntries((participants || []).map((p) => [p.id, p.name]));
    const enrichedCaptures = (captures || []).map((c) => ({
      id: c.id,
      capturer_name: idToName[c.capturer_id] || 'someone',
      captured_name: c.captured_name,
      captured_email: c.captured_email,
      captured_linkedin_url: c.captured_linkedin_url,
      created_at: c.created_at,
    }));
    return NextResponse.json({
      role: 'host',
      session: {
        id: session.id,
        code: session.code,
        name: session.name,
        status: session.status,
        rounds_total: session.rounds_total,
        ended_at: session.ended_at,
      },
      stats: {
        total_participants: (participants || []).length,
        total_captures: enrichedCaptures.length,
        total_rounds: (rounds || []).filter((r) => r.ended_at).length,
      },
      participants: (participants || []).map((p) => ({
        id: p.id,
        name: p.name,
        email: p.profiles?.email || null,
        linkedin_url: p.profiles?.linkedin_url || null,
        joined_at: p.joined_at,
        left_at: p.left_at,
      })),
      captures: enrichedCaptures,
      rounds: rounds || [],
    });
  }

  // participant view: only their own captures + who captured them
  const { data: theirCaptures } = await admin
    .from('captures')
    .select('id, captured_name, captured_linkedin_url, created_at')
    .eq('session_id', sessionId)
    .eq('capturer_id', participantId)
    .order('created_at', { ascending: true });

  const { data: capturedByOthers } = await admin
    .from('captures')
    .select('id, capturer_id, created_at')
    .eq('session_id', sessionId)
    .eq('captured_id', participantId);

  // resolve names of folks who captured them (we DON'T share their email or linkedin here ·
  // those go to the capturer, not the captured. just count + names.)
  let mutualCount = 0;
  if (capturedByOthers && capturedByOthers.length > 0) {
    const capturerIds = capturedByOthers.map((c) => c.capturer_id);
    const myCapturedIds = (theirCaptures || []).map((c) => c.id);
    // count mutual: where both A captured B AND B captured A
    // we'd need to look up capturer participant_ids that also appear as captured in theirCaptures
    const { data: mutualRows } = await admin
      .from('captures')
      .select('captured_id')
      .eq('session_id', sessionId)
      .eq('capturer_id', participantId)
      .in('captured_id', capturerIds);
    mutualCount = (mutualRows || []).length;
  }

  return NextResponse.json({
    role: 'participant',
    session: {
      id: session.id,
      name: session.name,
      rounds_total: session.rounds_total,
      ended_at: session.ended_at,
    },
    captures: theirCaptures || [],
    captured_by_count: (capturedByOthers || []).length,
    mutual_capture_count: mutualCount,
  });
}
