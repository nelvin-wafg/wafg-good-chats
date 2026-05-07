import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { getApprovedHost } from '@/lib/auth';
import { createRoom, deleteRoom } from '@/lib/daily';
import { planRound } from '@/lib/pairing';

// pretty room labels for that "mom's kitchen table" feel
const ROOM_LABELS = [
  "mom's kitchen table",
  "the storyteller's corner",
  "the front porch",
  "campfire seat",
  "long walk",
  "back booth",
  "rooftop",
  "garden bench",
  "two coffees in",
  "the lighthouse",
  "open window",
  "good news desk",
  "neighbor's stoop",
  "shared umbrella",
  "the slow lane",
];

// POST /api/sessions/:id/round  body: { action: 'start' | 'end', allowRepeats?: boolean }
// allowRepeats=true on action='start' lets the host run another round even when
// all unique pairings have been exhausted · pairs may repeat.
export async function POST(request, { params }) {
  const auth = await getApprovedHost();
  if (!auth) return new NextResponse('not an approved host', { status: 403 });

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  const allowRepeats = Boolean(body?.allowRepeats);

  const admin = adminClient();
  const { data: session } = await admin
    .from('sessions')
    .select('*')
    .eq('id', params.id)
    .single();
  if (!session) return new NextResponse('session not found', { status: 404 });

  if (action === 'start') return startRound(admin, session, { allowRepeats });
  if (action === 'end') return endRound(admin, session);
  return new NextResponse('invalid action', { status: 400 });
}

async function startRound(admin, session, { allowRepeats = false } = {}) {
  // accept 'closing' too when allowRepeats is set · host wants to extend post-final-round
  const validStatuses = allowRepeats
    ? ['live', 'between_rounds', 'closing']
    : ['live', 'between_rounds'];
  if (!validStatuses.includes(session.status)) {
    return new NextResponse(`cannot start round from status ${session.status}`, { status: 400 });
  }
  if (session.current_round >= session.rounds_total) {
    if (!allowRepeats) {
      return new NextResponse('all rounds complete', { status: 400 });
    }
    // extend rounds_total by 1 so the round counter stays sensible (round X of X+1)
    await admin
      .from('sessions')
      .update({ rounds_total: session.rounds_total + 1 })
      .eq('id', session.id);
    session.rounds_total = session.rounds_total + 1;
  }

  const newRoundNumber = (session.current_round || 0) + 1;

  // get currently-present participants
  const { data: presentParticipants = [] } = await admin
    .from('participants')
    .select('id, name')
    .eq('session_id', session.id)
    .eq('is_present', true);

  if (presentParticipants.length < 2) {
    return new NextResponse('need at least 2 people present to pair', { status: 400 });
  }

  // auto-cap rounds_total at the very first round based on actual attendance.
  // with N people, max unique rounds is N-1 (everyone meets everyone exactly once).
  // beyond that, pairs would have to repeat. capping makes the natural session length
  // match attendance · host can extend manually later if they want repeats.
  if (newRoundNumber === 1) {
    const maxUnique = Math.max(1, presentParticipants.length - 1);
    if (session.rounds_total > maxUnique) {
      await admin
        .from('sessions')
        .update({ rounds_total: maxUnique })
        .eq('id', session.id);
      session.rounds_total = maxUnique;
    }
  }

  // pull past pair history for no-repeats
  const { data: pastPairings = [] } = await admin
    .from('pairings')
    .select('participant_a_id, participant_b_id')
    .eq('session_id', session.id);
  const pastSet = new Set();
  for (const p of pastPairings) {
    if (p.participant_a_id && p.participant_b_id) {
      const k = p.participant_a_id < p.participant_b_id
        ? `${p.participant_a_id}:${p.participant_b_id}`
        : `${p.participant_b_id}:${p.participant_a_id}`;
      pastSet.add(k);
    }
  }

  // sit-out history
  const { data: sitOutRows = [] } = await admin
    .from('pairings')
    .select('participant_a_id')
    .eq('session_id', session.id)
    .is('participant_b_id', null);
  const sitOutHistory = {};
  for (const r of sitOutRows) sitOutHistory[r.participant_a_id] = (sitOutHistory[r.participant_a_id] || 0) + 1;

  const ids = presentParticipants.map((p) => p.id);
  const idToName = Object.fromEntries(presentParticipants.map((p) => [p.id, p.name]));
  const { pairs, sitOut } = planRound({
    participants: ids,
    pastPairs: pastSet,
    sitOutHistory,
  });

  // create round row
  const promptText = session.prompts?.[newRoundNumber - 1]?.text || null;
  const { data: round, error: roundErr } = await admin
    .from('rounds')
    .insert({
      session_id: session.id,
      round_number: newRoundNumber,
      prompt_text: promptText,
    })
    .select('id')
    .single();
  if (roundErr) return new NextResponse(roundErr.message, { status: 500 });

  // create daily rooms + pairings in parallel
  const roomExpMinutes = Math.max(8, Math.ceil(session.round_seconds / 60) + 3);
  const pairingInserts = await Promise.all(
    pairs.map(async ([a, b], idx) => {
      const labelIdx = (newRoundNumber * 7 + idx) % ROOM_LABELS.length;
      const label = ROOM_LABELS[labelIdx];
      const roomName = `wafg-${session.code}-r${newRoundNumber}-p${idx}-${Date.now().toString(36).slice(-4)}`;
      let createdName = roomName;
      try {
        const r = await createRoom({ name: roomName, expMinutes: roomExpMinutes });
        createdName = r.name;
      } catch (e) {
        console.error('failed to create daily room', e);
      }
      return {
        round_id: round.id,
        session_id: session.id,
        participant_a_id: a,
        participant_b_id: b,
        room_name: createdName,
        room_label: label,
      };
    })
  );

  // sit-out person (if any) · stays in main room with the host this round
  if (sitOut) {
    pairingInserts.push({
      round_id: round.id,
      session_id: session.id,
      participant_a_id: sitOut,
      participant_b_id: null,
      room_name: null,
      room_label: 'with the host',
    });
  }

  await admin.from('pairings').insert(pairingInserts);

  // update participants' current_room_name so the participant client knows where to go
  for (const insert of pairingInserts) {
    if (insert.room_name) {
      await admin
        .from('participants')
        .update({ current_room_name: insert.room_name })
        .in('id', [insert.participant_a_id, insert.participant_b_id].filter(Boolean));
    }
  }

  // update session status
  await admin
    .from('sessions')
    .update({
      status: 'running_round',
      current_round: newRoundNumber,
      current_round_started_at: new Date().toISOString(),
    })
    .eq('id', session.id);

  return NextResponse.json({
    ok: true,
    round: newRoundNumber,
    pairs: pairingInserts.length,
    sitOutId: sitOut,
  });
}

async function endRound(admin, session) {
  if (session.status !== 'running_round') {
    return new NextResponse('no round running', { status: 400 });
  }

  // mark round ended
  await admin
    .from('rounds')
    .update({ ended_at: new Date().toISOString() })
    .eq('session_id', session.id)
    .eq('round_number', session.current_round);

  // pull pairings for this round to find rooms to tear down
  const { data: roundRows = [] } = await admin
    .from('rounds')
    .select('id')
    .eq('session_id', session.id)
    .eq('round_number', session.current_round);
  const roundId = roundRows[0]?.id;
  if (roundId) {
    const { data: pairings = [] } = await admin
      .from('pairings')
      .select('room_name')
      .eq('round_id', roundId);
    // delete daily rooms (fire-and-forget; ignore errors)
    Promise.all(
      pairings.filter((p) => p.room_name).map((p) => deleteRoom(p.room_name).catch(() => {}))
    );
  }

  // bring everyone back to main room
  await admin
    .from('participants')
    .update({ current_room_name: null })
    .eq('session_id', session.id);

  // determine if more rounds left
  const isLast = session.current_round >= session.rounds_total;
  await admin
    .from('sessions')
    .update({
      status: isLast ? 'closing' : 'between_rounds',
      current_round_started_at: null,
    })
    .eq('id', session.id);

  return NextResponse.json({ ok: true, isLast });
}
