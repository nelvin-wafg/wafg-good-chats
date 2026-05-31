'use client';
import { useEffect, useRef, useState } from 'react';
import { DailyProvider, DailyAudio, useDaily, useParticipantIds, useLocalSessionId, useMediaTrack, useParticipantProperty, useActiveSpeakerId } from '@daily-co/daily-react';
import DailyIframe from '@daily-co/daily-js';
import { colorForName, initials } from '@/lib/brand';
import CopyLink from '@/components/CopyLink';
import ChatPanel from '@/components/ChatPanel';
import DeviceMenu from '@/components/DeviceMenu';
import ViewModeToggle from '@/components/ViewModeToggle';
import { showToast } from '@/components/Toast';

// host's command center · runs the session AND shows up on camera in the main room.
// host stays in the main daily.co room for the entire active session
// (does NOT hop into pair rooms during rounds · participants do that on their own).

export default function LiveControl({ session: initialSession }) {
  const [session, setSession] = useState(initialSession);
  const [participants, setParticipants] = useState([]);
  const [pairings, setPairings] = useState([]);
  const [pairingsHistory, setPairingsHistory] = useState([]);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [callObject, setCallObject] = useState(null);

  // poll session state
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${session.id}/state?host=1`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSession((s) => ({ ...s, ...data.session }));
        setParticipants(data.participants || []);
        setPairings(data.pairings || []);
        setPairingsHistory(data.pairingsHistory || []);
        if (data.session?.current_round_started_at) {
          const startedAt = new Date(data.session.current_round_started_at).getTime();
          const elapsed = Math.floor((Date.now() - startedAt) / 1000);
          setSecondsLeft(Math.max(0, session.round_seconds - elapsed));
        }
      } catch {}
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [session.id, session.round_seconds]);

  // local timer tick (between server polls)
  useEffect(() => {
    if (session.status !== 'running_round') return;
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [session.status]);

  // auto-advance: when the round timer hits 0, move straight into the next round
  // (or to closeout if that was the last one). the host tab is the clock authority,
  // so this fires here · participants just follow their new assignment on the next
  // poll. the ref guards against firing more than once per round.
  //
  // we use an INDEPENDENT 1s heartbeat (not a useEffect on secondsLeft) for two
  // reasons: React bails on identical state updates so a settled secondsLeft===0
  // wouldn't re-trigger an effect; and browsers throttle setInterval when the tab
  // is backgrounded, but as soon as the tab returns the next tick fires immediately
  // and the server-derived elapsed check is correct without needing local state to
  // be up-to-date.
  const advanceFiredRef = useRef(null);
  useEffect(() => {
    const tick = () => {
      if (session.status !== 'running_round') return;
      if (!session.current_round_started_at) return;
      const startedAt = new Date(session.current_round_started_at).getTime();
      if (!Number.isFinite(startedAt)) return;
      const elapsedSeconds = (Date.now() - startedAt) / 1000;
      if (elapsedSeconds < session.round_seconds) return;
      if (advanceFiredRef.current === session.current_round) return;
      advanceFiredRef.current = session.current_round;
      action('round', { action: 'end' });
    };
    tick(); // check immediately so we don't have to wait 1s after a state change
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [session.status, session.current_round, session.current_round_started_at, session.round_seconds]); // eslint-disable-line

  // join main daily.co room when session is active
  useEffect(() => {
    let mounted = true;
    const isActive = ['live', 'running_round', 'between_rounds', 'closing'].includes(session.status);
    const wantsCall = isActive && session.main_room_name;

    async function manageCall() {
      if (!wantsCall) {
        if (callObject) {
          await callObject.leave().catch(() => {});
          callObject.destroy();
          setCallObject(null);
        }
        return;
      }
      if (callObject) return; // already in a call

      // get host token (isOwner: true)
      const tokenRes = await fetch(`/api/daily/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          roomName: session.main_room_name,
          userName: 'host',
          isOwner: true,
        }),
      });
      if (!tokenRes.ok) return;
      const { token, url } = await tokenRes.json();
      if (!mounted) return;

      let co;
      try {
        co = DailyIframe.getCallInstance() || DailyIframe.createCallObject({ videoSource: true, audioSource: true });
      } catch {
        co = DailyIframe.getCallInstance() || null;
      }
      if (!co) return;
      await co.join({ url, token });
      if (!mounted) { try { co.leave(); } catch {} co.destroy(); return; }

      // defensive: explicitly enable local video + audio after join.
      // some browsers don't reliably honor videoSource:true on createCallObject alone,
      // and the symptom is "the host's camera doesn't publish, nobody sees them."
      try { await co.setLocalVideo(true); } catch (e) { console.warn('[daily] setLocalVideo failed', e); }
      try { await co.setLocalAudio(true); } catch (e) { console.warn('[daily] setLocalAudio failed', e); }

      // attempt daily's krisp noise cancellation; falls back silently
      try {
        await co.updateInputSettings({ audio: { processor: { type: 'noise-cancellation' } } });
      } catch {}

      setCallObject(co);
    }
    manageCall();
    return () => { mounted = false; };
  }, [session.status, session.main_room_name]); // eslint-disable-line

  // cleanup
  useEffect(() => {
    return () => {
      if (callObject) {
        callObject.leave().catch(() => {});
        callObject.destroy();
      }
    };
  }, [callObject]);

  // kick a participant: eject them from the daily call (their tab gets a
  // 'left-meeting' event and disconnects) AND mark them absent in the db so
  // the host views update immediately. they could still rejoin via the link.
  async function kickParticipant(participantId, participantName) {
    if (!participantId) return;
    if (!confirm(`remove ${participantName || 'this person'} from the session?`)) return;
    // 1 · daily eject (client-side · we have the call object here)
    if (callObject) {
      try {
        const dailyParticipants = callObject.participants();
        for (const [sid, p] of Object.entries(dailyParticipants || {})) {
          if (sid === 'local') continue;
          if (p?.user_id === participantId) {
            try { callObject.updateParticipant(sid, { eject: true }); } catch (e) { console.warn('[kick] eject failed', e); }
            break;
          }
        }
      } catch (e) {
        console.warn('[kick] enumerate participants failed', e);
      }
    }
    // 2 · mark absent in db so host views stop showing them
    try {
      await fetch(`/api/sessions/${session.id}/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ participantId }),
      });
    } catch (e) {
      showToast("couldn't fully remove · refresh host view", 'error');
    }
  }

  async function action(path, body) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const text = await res.text();
        showToast(text || `request failed (${res.status})`, 'error');
      }
    } catch (e) {
      showToast(e.message || 'something went wrong', 'error');
    } finally {
      setBusy(false);
    }
  }

  // build a name→profile lookup so video tiles can resolve linkedin
  const participantsByName = participants.reduce((acc, p) => {
    if (p.name) acc[p.name] = p;
    return acc;
  }, {});

  // security + cleanup: eject participants who've genuinely gone away.
  // a stale row is one whose heartbeat (last_seen) is older than STALE_MS · a
  // browser refresh updates last_seen within ~2s so refreshes never trigger.
  //
  // we do TWO things for each stale row:
  //  1. mark them absent in the db via the same /kick endpoint manual kicks use
  //     · this is what stops phantom names from sticking in "in main room" when
  //     a participant's tab dies without firing pagehide (mobile especially).
  //  2. if they're still in the Daily participants list, eject them from the
  //     call too so their video tile clears for everyone else.
  //
  // a ref guards against re-firing /kick for the same participant repeatedly
  // while we wait for the next poll to confirm they're absent.
  const recentlyKickedRef = useRef(new Set());
  useEffect(() => {
    if (!callObject) return;
    const now = Date.now();
    const STALE_MS = 8000;
    const staleParticipants = participants.filter((p) => {
      if (!p.is_present) return false; // already absent · nothing to do
      const seen = p.last_seen ? new Date(p.last_seen).getTime() : 0;
      return now - seen > STALE_MS;
    });
    if (staleParticipants.length === 0) return;

    const dailyParticipants = callObject.participants() || {};
    const dailySessionByUserId = {};
    for (const [sid, p] of Object.entries(dailyParticipants)) {
      if (sid === 'local') continue;
      if (p?.user_id) dailySessionByUserId[p.user_id] = sid;
    }

    for (const sp of staleParticipants) {
      if (recentlyKickedRef.current.has(sp.id)) continue;
      recentlyKickedRef.current.add(sp.id);
      // clear the guard after 30s so a true reconnect can be detected later
      setTimeout(() => { recentlyKickedRef.current.delete(sp.id); }, 30000);

      console.log('[presence] marking stale participant absent:', sp.id, sp.name);
      // 1 · daily eject (only if they're actually still in the call)
      const sid = dailySessionByUserId[sp.id];
      if (sid) {
        try { callObject.updateParticipant(sid, { eject: true }); }
        catch (e) { console.warn('[presence] eject failed', e); }
      }
      // 2 · mark absent in db so host views stop showing them
      fetch(`/api/sessions/${session.id}/kick`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ participantId: sp.id }),
      }).catch((e) => console.warn('[presence] kick api failed', e));
    }
  }, [callObject, participants, session.id]);

  const inner = (
    <LiveControlInner
      session={session}
      participants={participants}
      participantsByName={participantsByName}
      pairings={pairings}
      pairingsHistory={pairingsHistory}
      secondsLeft={secondsLeft}
      busy={busy}
      action={action}
      hasCall={Boolean(callObject)}
      onKick={kickParticipant}
    />
  );

  if (callObject) {
    return (
      <DailyProvider callObject={callObject}>
        {inner}
        {/* hidden audio elements so the host hears everyone in the main room */}
        <DailyAudio />
      </DailyProvider>
    );
  }
  return inner;
}

// ============================================================================
// inner component (uses daily hooks if wrapped in DailyProvider)
// ============================================================================
function LiveControlInner({ session, participants, participantsByName, pairings, pairingsHistory, secondsLeft, busy, action, hasCall, onKick }) {
  const isPre = session.status === 'draft' || session.status === 'live';
  const isRunning = session.status === 'running_round';
  const isBetween = session.status === 'between_rounds';
  const isEnded = session.status === 'ended';

  // host video view mode · persisted in localStorage so it sticks across sessions
  const [viewMode, setViewMode] = useState('gallery');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('gc:hostViewMode');
      if (saved === 'gallery' || saved === 'speaker' || saved === 'large') setViewMode(saved);
    } catch {}
  }, []);
  function updateViewMode(m) {
    setViewMode(m);
    try { window.localStorage.setItem('gc:hostViewMode', m); } catch {}
  }

  const promptIdx = (session.current_round || 1) - 1;
  const currentPrompt = session.prompts?.[promptIdx]?.text;
  const nextPrompt = session.prompts?.[(session.current_round || 0)]?.text;

  return (
    <main className="min-h-screen flex flex-col text-white" style={{ background: '#0a0a0a' }}>
      <header className="border-b border-neutral-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <a href="/host" className="text-xs text-neutral-500 hover:text-white whitespace-nowrap">← dashboard</a>
          <span className="text-neutral-600">·</span>
          <span className="text-sm font-semibold truncate">{session.name}</span>
          <HeaderCopyLink code={session.code} />
          <span className="text-neutral-600">·</span>
          <CoHostCopyLink sessionId={session.id} />
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded ${isRunning ? 'animate-pulse' : ''}`} style={{ background: isEnded ? '#444' : '#01ecf3', color: isEnded ? '#aaa' : '#000' }}>
            {session.status.replace(/_/g, ' ')}
          </span>
          <span className="text-sm text-neutral-400">
            <strong style={{ color: '#01ecf3' }}>{participants.filter((p) => p.is_present).length}</strong> here
          </span>
        </div>
      </header>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr,400px] overflow-hidden">

        {/* main · controls + video gallery */}
        <div className="flex flex-col overflow-hidden">

          {/* state-specific controls bar */}
          <div className="px-6 py-4 border-b border-neutral-800">
            {session.status === 'draft' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="display text-2xl">ready when you are.</div>
                    <p className="text-sm text-neutral-400 mt-1">share the link below · then hit go live</p>
                  </div>
                  <button onClick={() => action('start')} disabled={busy} className="btn-cyan px-6 py-3 rounded-md text-lg whitespace-nowrap">
                    go live *
                  </button>
                </div>
                <CopyLink code={session.code} variant="dark" label="participant link" />
              </div>
            )}

            {session.status === 'live' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="display text-2xl">main room is open.</div>
                    <p className="text-sm text-neutral-400 mt-1">welcome folks · kick it off when ready</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => action('round', { action: 'start' })} disabled={busy} className="btn-cyan px-6 py-3 rounded-md text-lg whitespace-nowrap">
                      kick it off *
                    </button>
                    <button onClick={() => { if (confirm('end this session now? this closes the room and marks the session ended.')) action('end'); }} disabled={busy} className="px-4 py-3 rounded-md border-2 border-red-500 text-red-400 hover:bg-red-500 hover:text-white font-semibold text-sm whitespace-nowrap">
                      end session
                    </button>
                  </div>
                </div>
                <CopyLink code={session.code} variant="dark" label="still need to share? grab the link" />
              </div>
            )}

            {isBetween && (
              <BetweenRoundsBar
                session={session}
                nextPrompt={nextPrompt}
                busy={busy}
                action={action}
              />
            )}

            {isRunning && (
              <div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: '#01ecf3' }}>round {session.current_round} of {session.rounds_total} · live</div>
                    {currentPrompt && <div className="display text-base">{currentPrompt}</div>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="display text-4xl" style={{ color: secondsLeft <= 30 ? '#fbbf24' : '#01ecf3' }}>
                      {fmtTime(secondsLeft)}
                    </div>
                    <button onClick={() => action('round', { action: 'end' })} disabled={busy} className="btn-cyan px-4 py-2 rounded-md text-sm">end round *</button>
                    <button onClick={() => { if (confirm('end the whole session?')) action('end'); }} disabled={busy} className="px-4 py-2 rounded-md border-2 border-red-500 text-red-400 hover:bg-red-500 hover:text-white font-semibold text-sm">end session</button>
                  </div>
                </div>
                {(() => {
                  const withHostPairing = pairings.find((p) => !p.participant_b_name);
                  if (!withHostPairing) return null;
                  return (
                    <div className="mt-3 px-4 py-2 rounded text-sm" style={{ background: 'rgba(1,236,243,0.15)', color: '#01ecf3' }}>
                      <span className="font-bold uppercase tracking-widest text-[10px] mr-2">your conversation this round:</span>
                      <span className="font-semibold">{withHostPairing.participant_a_name}</span>
                      <span className="text-neutral-400 ml-2">· they're with you in main room</span>
                    </div>
                  );
                })()}
              </div>
            )}

            {session.status === 'closing' && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="display text-2xl">all rounds wrapped.</div>
                  <p className="text-sm text-neutral-400 mt-1">say a final thing · close out · or run another round (pairs may repeat)</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (confirm('run another round? everyone has already met everyone, so pairs will repeat.')) action('round', { action: 'start', allowRepeats: true }); }}
                    disabled={busy}
                    className="px-4 py-3 rounded-md border-2 border-cyan-400 text-cyan-300 hover:bg-cyan-400 hover:text-black font-semibold text-sm whitespace-nowrap"
                  >
                    do another round
                  </button>
                  <button
                    onClick={() => { if (confirm('close out the session and end the call for everyone?')) action('end'); }}
                    disabled={busy}
                    className="btn-cyan px-6 py-3 rounded-md text-lg whitespace-nowrap"
                  >
                    close out *
                  </button>
                </div>
              </div>
            )}

            {isEnded && <HostRecapPanel sessionId={session.id} />}
          </div>

          {/* video gallery · everyone in the main daily room */}
          <div className="flex-1 overflow-y-auto p-4 flex flex-col min-h-0">
            {hasCall && (
              <div className="flex items-center justify-end mb-2 flex-shrink-0">
                <ViewModeToggle mode={viewMode} onChange={updateViewMode} theme="dark" />
              </div>
            )}
            {hasCall ? <HostVideoGallery participantsByName={participantsByName} mode={viewMode} /> : (
              <div className="h-full flex items-center justify-center text-neutral-600 text-sm text-center px-6">
                {isEnded
                  ? '[session has ended]'
                  : session.status === 'draft'
                    ? '[click "go live *" to open the main room]'
                    : '[connecting to main room... if this sticks for more than a few seconds, check browser devtools → network for /api/daily/token errors]'}
              </div>
            )}
          </div>

          {/* mic/cam controls (only when in call) */}
          {hasCall && <HostControlBar />}
        </div>

        {/* right rail */}
        <aside className="bg-black border-l border-neutral-800 p-6 overflow-y-auto flex flex-col gap-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">
              in main room ({participants.filter((p) => p.is_present && !p.current_room_name).length})
            </div>
            <div className="grid grid-cols-4 gap-2">
              {participants.filter((p) => p.is_present && !p.current_room_name).map((p) => (
                <div key={p.id} className="text-center relative group">
                  <div className="w-12 h-12 mx-auto rounded-full display flex items-center justify-center text-black text-base" style={{ background: colorForName(p.name) }}>
                    {initials(p.name)}
                  </div>
                  <div className="text-[10px] mt-1 text-neutral-400 truncate">{p.name?.split(' ')[0]}</div>
                  <button
                    type="button"
                    onClick={() => onKick?.(p.id, p.name)}
                    className="absolute -top-1 right-1 w-5 h-5 rounded-full bg-red-600 text-white text-xs font-bold hidden group-hover:flex items-center justify-center leading-none"
                    title={`remove ${p.name} from the session`}
                  >
                    ×
                  </button>
                </div>
              ))}
              {participants.filter((p) => p.is_present && !p.current_room_name).length === 0 && (
                <div className="col-span-4 text-xs text-neutral-600 italic">[no one here yet]</div>
              )}
            </div>
          </div>

          {hasCall && (
            <ChatPanel
              myName="host"
              title="room chat"
              placeholder="message the room..."
              emptyHint="[messages from people in the main room show up here]"
              className="flex h-72 border border-neutral-800 rounded-md"
            />
          )}

          {pairings.length > 0 && isRunning && (
            <div>
              <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">live pairings</div>
              <div className="space-y-2">
                {pairings.map((pa) => {
                  const isWithHost = !pa.participant_b_name;
                  return (
                    <div
                      key={pa.id}
                      className={`rounded p-3 text-sm border ${isWithHost ? 'border-cyan-400' : 'bg-neutral-900 border-neutral-800'}`}
                      style={isWithHost ? { background: 'rgba(1,236,243,0.1)', borderColor: '#01ecf3' } : {}}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-medium truncate">{pa.participant_a_name}</span>
                          <button
                            type="button"
                            onClick={() => onKick?.(pa.participant_a_id, pa.participant_a_name)}
                            className="w-4 h-4 rounded-full bg-red-600/40 hover:bg-red-600 text-white text-[10px] font-bold flex items-center justify-center leading-none flex-shrink-0"
                            title={`remove ${pa.participant_a_name} from the session`}
                          >
                            ×
                          </button>
                          <span className="text-neutral-500">·</span>
                          <span className={`font-medium truncate ${isWithHost ? '' : ''}`} style={isWithHost ? { color: '#01ecf3' } : {}}>
                            {isWithHost ? 'you (host)' : pa.participant_b_name}
                          </span>
                          {!isWithHost && pa.participant_b_id && (
                            <button
                              type="button"
                              onClick={() => onKick?.(pa.participant_b_id, pa.participant_b_name)}
                              className="w-4 h-4 rounded-full bg-red-600/40 hover:bg-red-600 text-white text-[10px] font-bold flex items-center justify-center leading-none flex-shrink-0"
                              title={`remove ${pa.participant_b_name} from the session`}
                            >
                              ×
                            </button>
                          )}
                        </div>
                        <span className="text-[10px] whitespace-nowrap" style={{ color: '#01ecf3' }}>* {pa.room_label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <RoundHistoryPanel pairingsHistory={pairingsHistory} currentRound={session.current_round} />

          <div className="border-t border-neutral-800 pt-5">
            <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">session info</div>
            <div className="text-sm space-y-1 text-neutral-300">
              <div className="flex justify-between"><span>rounds</span><span style={{ color: '#01ecf3' }}>{session.current_round}/{session.rounds_total}</span></div>
              <div className="flex justify-between"><span>per round</span><span style={{ color: '#01ecf3' }}>{Math.round(session.round_seconds / 60)} min</span></div>
              <div className="flex justify-between"><span>total joined</span><span style={{ color: '#01ecf3' }}>{participants.length}</span></div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

// ============================================================================
// host video gallery · all daily participants in the main room
// supports three layouts driven by `mode`: gallery (default), speaker, large
// ============================================================================
function HostVideoGallery({ participantsByName, mode = 'gallery' }) {
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const activeSpeakerId = useActiveSpeakerId();
  const ids = [localId, ...remoteIds].filter(Boolean);

  if (ids.length === 0) {
    return <div className="h-full flex items-center justify-center text-neutral-600 text-sm">[joining main room...]</div>;
  }

  if (mode === 'speaker') {
    let featured = activeSpeakerId && ids.includes(activeSpeakerId) ? activeSpeakerId : null;
    if (!featured) featured = localId || ids[0];
    const others = ids.filter((id) => id !== featured);
    return (
      <div className="flex flex-col gap-3 flex-1 min-h-0">
        <div className="flex-1 min-h-0">
          <DailyVideoTile
            key={featured}
            sessionId={featured}
            isLocal={featured === localId}
            participantsByName={participantsByName}
            tileClassName="w-full h-full"
          />
        </div>
        {others.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 flex-shrink-0">
            {others.map((id) => (
              <div key={id} className="w-40 flex-shrink-0">
                <DailyVideoTile
                  sessionId={id}
                  isLocal={id === localId}
                  participantsByName={participantsByName}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const minTile = mode === 'large' ? '280px' : '160px';
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${minTile}, 1fr))` }}>
      {ids.map((id) => (
        <DailyVideoTile key={id} sessionId={id} isLocal={id === localId} participantsByName={participantsByName} />
      ))}
    </div>
  );
}

function DailyVideoTile({ sessionId, isLocal, participantsByName, tileClassName }) {
  const ref = useRef();
  const videoState = useMediaTrack(sessionId, 'video');
  const userName = useParticipantProperty(sessionId, 'user_name');
  const name = userName || (isLocal ? 'host' : 'guest');
  const hasVideo = !!videoState?.persistentTrack && videoState.state !== 'off';

  useEffect(() => {
    if (!ref.current) return;
    const track = videoState?.persistentTrack;
    if (track) {
      ref.current.srcObject = new MediaStream([track]);
    } else {
      ref.current.srcObject = null;
    }
  }, [videoState?.persistentTrack]);

  // host tile is the local one in LiveControl context
  const isHostTile = isLocal;
  const displayName = isLocal ? `${name} · you` : name;
  const linkedinUrl = !isHostTile ? participantsByName?.[name]?.linkedin_url : null;

  return (
    <div
      className={`relative rounded-md overflow-hidden bg-neutral-900 ${tileClassName || 'aspect-video'}`}
      style={isHostTile ? { border: '2px solid #01ecf3' } : { border: '1px solid #333' }}
    >
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={isLocal}
        className="w-full h-full object-cover"
        style={isLocal ? { transform: 'scaleX(-1)' } : undefined}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center" style={{ background: '#1a1a1a' }}>
          <div
            className="w-16 h-16 rounded-full display flex items-center justify-center text-black text-xl"
            style={{ background: colorForName(name || '') }}
          >
            {initials(name || '?')}
          </div>
        </div>
      )}
      <div className="absolute bottom-2 left-2 bg-black px-2.5 py-1.5 rounded-md text-sm font-bold text-white flex items-center gap-2">
        <span>{displayName}</span>
        {linkedinUrl && (
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="open linkedin"
            className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold no-underline"
            style={{ background: '#0a66c2', color: '#fff' }}
          >
            in
          </a>
        )}
      </div>
      {isHostTile && (
        <div className="absolute top-2 left-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded" style={{ background: '#01ecf3', color: '#000' }}>
          host
        </div>
      )}
    </div>
  );
}

function HostControlBar() {
  const daily = useDaily();
  const [audioOn, setAudioOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);

  function toggleAudio() {
    if (!daily) return;
    const next = !audioOn;
    daily.setLocalAudio(next);
    setAudioOn(next);
  }
  function toggleVideo() {
    if (!daily) return;
    const next = !videoOn;
    daily.setLocalVideo(next);
    setVideoOn(next);
  }

  return (
    <div className="border-t border-neutral-800 px-6 py-3 flex items-center justify-center gap-3 bg-black">
      <div className="flex items-center gap-1">
        <CtrlBtn on={audioOn} onClick={toggleAudio} label={audioOn ? 'mic on' : 'mic off'} />
        <DeviceMenu kind="audio" daily={daily} theme="dark" />
      </div>
      <div className="flex items-center gap-1">
        <CtrlBtn on={videoOn} onClick={toggleVideo} label={videoOn ? 'cam on' : 'cam off'} />
        <DeviceMenu kind="video" daily={daily} theme="dark" />
      </div>
    </div>
  );
}

function CtrlBtn({ on, onClick, label }) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={`px-4 py-2 rounded-full text-xs font-semibold border ${on ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-red-900/30 border-red-700 text-red-300'}`}
    >
      {label}
    </button>
  );
}

function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// between rounds, auto-advance to the next round after a short countdown.
// host can pause/resume the countdown.
function BetweenRoundsBar({ session, nextPrompt, busy, action }) {
  const AUTO_ADVANCE_SECONDS = 15;
  const [remaining, setRemaining] = useState(AUTO_ADVANCE_SECONDS);
  const [paused, setPaused] = useState(false);
  const [triggered, setTriggered] = useState(false);

  // reset countdown whenever between_rounds re-enters or current_round changes
  useEffect(() => {
    setRemaining(AUTO_ADVANCE_SECONDS);
    setPaused(false);
    setTriggered(false);
  }, [session.current_round]);

  // tick down
  useEffect(() => {
    if (paused || triggered) return;
    if (remaining <= 0) {
      setTriggered(true);
      action('round', { action: 'start' });
      return;
    }
    const id = setTimeout(() => setRemaining((r) => r - 1), 1000);
    return () => clearTimeout(id);
  }, [remaining, paused, triggered]); // eslint-disable-line

  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          <div className="display text-2xl">round {session.current_round} wrapped.</div>
          {!paused && !triggered && (
            <span className="text-sm" style={{ color: '#01ecf3' }}>
              · round {session.current_round + 1} starts in <strong>{remaining}s</strong>
            </span>
          )}
          {paused && (
            <span className="text-sm text-amber-400">· paused</span>
          )}
          {triggered && (
            <span className="text-sm text-neutral-500">· starting...</span>
          )}
        </div>
        {nextPrompt && <p className="text-sm text-neutral-400 mt-1 truncate">next: <span style={{ color: '#01ecf3' }}>{nextPrompt}</span></p>}
      </div>
      <div className="flex items-center gap-2">
        {!triggered && (
          <button
            onClick={() => setPaused((p) => !p)}
            disabled={busy}
            className="px-3 py-2 rounded-md border border-neutral-600 text-neutral-300 hover:bg-neutral-800 text-xs whitespace-nowrap"
          >
            {paused ? 'resume' : 'hold up'}
          </button>
        )}
        <button onClick={() => action('round', { action: 'start' })} disabled={busy || triggered} className="btn-cyan px-5 py-3 rounded-md text-base whitespace-nowrap">
          start now *
        </button>
        <button onClick={() => { if (confirm('end this session now? skips remaining rounds.')) action('end'); }} disabled={busy} className="px-3 py-2 rounded-md border-2 border-red-500 text-red-400 hover:bg-red-500 hover:text-white font-semibold text-xs whitespace-nowrap">
          end session
        </button>
      </div>
    </div>
  );
}

// round history · all rounds and their pairings, current round highlighted
function RoundHistoryPanel({ pairingsHistory, currentRound }) {
  if (!pairingsHistory || pairingsHistory.length === 0) return null;

  // group by round number
  const byRound = {};
  for (const p of pairingsHistory) {
    if (!byRound[p.round_number]) byRound[p.round_number] = [];
    byRound[p.round_number].push(p);
  }
  const rounds = Object.keys(byRound).map(Number).sort((a, b) => a - b);

  return (
    <div className="border-t border-neutral-800 pt-5">
      <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">round history</div>
      <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1">
        {rounds.map((rn) => {
          const isCurrent = rn === currentRound;
          return (
            <div key={rn} className={`rounded p-2 ${isCurrent ? 'border border-cyan-700 bg-cyan-900/10' : 'bg-neutral-900 border border-neutral-800'}`}>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: isCurrent ? '#01ecf3' : '#888' }}>
                  round {rn}{isCurrent ? ' · live' : ''}
                </div>
                <div className="text-[10px] text-neutral-600">
                  {byRound[rn].filter((p) => p.participant_b_name).length} pair{byRound[rn].filter((p) => p.participant_b_name).length === 1 ? '' : 's'}
                </div>
              </div>
              <ul className="space-y-1">
                {byRound[rn].map((p) => (
                  <li key={p.id} className="text-xs flex items-center justify-between gap-2">
                    <span className="truncate">
                      <span className="font-medium">{p.participant_a_name}</span>
                      <span className="text-neutral-500"> × </span>
                      <span className="font-medium">{p.participant_b_name || <span className="italic text-neutral-500">with you</span>}</span>
                    </span>
                    {p.room_label && <span className="text-[9px] text-neutral-600 whitespace-nowrap">* {p.room_label}</span>}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// host post-session recap · pulls full data from /recap and renders summary + capture list
function HostRecapPanel({ sessionId }) {
  const [recap, setRecap] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${sessionId}/recap`, { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) { setRecap(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId]);

  if (loading) {
    return <div className="text-sm text-neutral-400">[pulling recap...]</div>;
  }
  if (!recap || recap.role !== 'host') {
    return (
      <div>
        <div className="display text-2xl mb-1">that's a wrap.</div>
        <a href="/host" className="inline-block mt-3 text-sm underline">back to dashboard →</a>
      </div>
    );
  }

  // tally captures per participant
  const capturerCounts = {};
  for (const c of recap.captures) capturerCounts[c.capturer_name] = (capturerCounts[c.capturer_name] || 0) + 1;

  return (
    <div>
      <div className="display text-2xl mb-3">that's a wrap.</div>

      <div className="grid grid-cols-3 gap-3 mb-5 max-w-md">
        <div className="bg-neutral-900 border border-neutral-800 rounded-md p-3">
          <div className="display text-2xl" style={{ color: '#01ecf3' }}>{recap.stats.total_participants}</div>
          <div className="text-[10px] uppercase tracking-widest font-bold mt-1 text-neutral-500">people</div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-md p-3">
          <div className="display text-2xl" style={{ color: '#01ecf3' }}>{recap.stats.total_rounds}</div>
          <div className="text-[10px] uppercase tracking-widest font-bold mt-1 text-neutral-500">rounds</div>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-md p-3">
          <div className="display text-2xl" style={{ color: '#01ecf3' }}>{recap.stats.total_captures}</div>
          <div className="text-[10px] uppercase tracking-widest font-bold mt-1 text-neutral-500">captures</div>
        </div>
      </div>

      {/* captures list */}
      {recap.captures.length > 0 && (
        <div className="bg-neutral-900 border border-neutral-800 rounded-md p-4 mb-5 max-w-2xl">
          <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">connections captured</div>
          <ul className="divide-y divide-neutral-800 max-h-64 overflow-y-auto">
            {recap.captures.map((c) => (
              <li key={c.id} className="py-2 text-sm flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-medium">{c.capturer_name}</span>
                  <span className="text-neutral-500"> wanted to stay in touch with </span>
                  <span className="font-medium">{c.captured_name}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {c.captured_linkedin_url && (
                    <a href={c.captured_linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: '#0a66c2', color: '#fff' }}>in</a>
                  )}
                  {c.captured_email && (
                    <span className="text-[10px] text-neutral-500 font-mono">{c.captured_email}</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* participants list */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-md p-4 mb-5 max-w-2xl">
        <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">all participants</div>
        <ul className="divide-y divide-neutral-800 max-h-64 overflow-y-auto">
          {recap.participants.map((p) => (
            <li key={p.id} className="py-2 text-sm flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="font-medium">{p.name}</span>
                {p.email && <span className="text-neutral-500 ml-2 font-mono text-xs">{p.email}</span>}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-xs text-neutral-500">
                <span>{capturerCounts[p.name] || 0} captures</span>
                {p.linkedin_url && (
                  <a href={p.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ background: '#0a66c2', color: '#fff' }}>in</a>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <a href="/host" className="inline-block text-sm underline text-neutral-400 hover:text-white">back to dashboard →</a>
    </div>
  );
}

// small inline copy-link for the header bar
function HeaderCopyLink({ code }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const url = `${window.location.origin}/r/${code}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <button
      onClick={copy}
      title="copy participant share link"
      className="text-xs flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
      style={{ color: copied ? '#01ecf3' : '#737373' }}
    >
      <span className="font-mono">/r/{code}</span>
      <span>{copied ? '✓ copied' : '· copy'}</span>
    </button>
  );
}

// co-host link · share with another approved host so they can run this session with you
function CoHostCopyLink({ sessionId }) {
  const [copied, setCopied] = useState(false);
  async function copy(e) {
    e.preventDefault();
    e.stopPropagation();
    try {
      const url = `${window.location.origin}/host/s/${sessionId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }
  return (
    <button
      onClick={copy}
      title="copy co-host link · share with another approved host (jon, becky)"
      className="text-xs flex items-center gap-1.5 hover:text-cyan-300 transition-colors"
      style={{ color: copied ? '#01ecf3' : '#737373' }}
    >
      <span>{copied ? '✓ co-host link copied' : 'co-host link'}</span>
    </button>
  );
}
