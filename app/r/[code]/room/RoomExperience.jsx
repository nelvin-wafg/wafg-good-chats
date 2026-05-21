'use client';
import { useEffect, useRef, useState } from 'react';
import { DailyProvider, useDaily, useParticipantIds, useLocalSessionId, useMediaTrack, useParticipantProperty } from '@daily-co/daily-react';
import DailyIframe from '@daily-co/daily-js';
import { colorForName, initials } from '@/lib/brand';
import { showToast } from '@/components/Toast';

// participant experience.
// state machine: lobby → main_room → splitting → pair_room → returning → main_room → ... → ended
// participant is in the main daily.co room whenever they're in the "with everyone" state,
// and switches to a pair daily.co room during rounds.
//
// session state from the server drives this; we poll every 2s.

export default function RoomExperience({ session: initialSession }) {
  const [participantId, setParticipantId] = useState(null);
  const [participantName, setParticipantName] = useState(null);
  const [session, setSession] = useState(initialSession);
  const [myAssignment, setMyAssignment] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [transition, setTransition] = useState(null); // null | "splitting"
  const [transitionCountdown, setTransitionCountdown] = useState(0);
  const [callObject, setCallObject] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null); // { name, isPair }

  // load participant name (UI only). authoritative identity is HttpOnly cookie.
  useEffect(() => {
    try {
      const pname = window.sessionStorage.getItem(`pname:${initialSession.id}`);
      if (!pname) {
        window.location.href = `/r/${initialSession.code}`;
        return;
      }
      setParticipantName(pname);
    } catch {}
  }, [initialSession]);

  // poll session state every 2 seconds. server identifies us via cookie.
  useEffect(() => {
    let cancelled = false;
    let consecutiveUnauthed = 0;
    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${initialSession.id}/state`, { credentials: 'same-origin' });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setSession((s) => ({ ...s, ...data.session }));
        setMyAssignment(data.assignment || null);
        setParticipants(data.participants || []);
        if (data.me?.participantId) {
          setParticipantId(data.me.participantId);
          consecutiveUnauthed = 0;
        } else {
          consecutiveUnauthed++;
          if (consecutiveUnauthed > 2) {
            window.location.href = `/r/${initialSession.code}`;
          }
        }
      } catch {}
    }
    poll();
    const id = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(id); };
  }, [initialSession.id, initialSession.code]);

  // figure out which daily room the participant should be in right now.
  // - in a pair room when we have an assignment with a roomName
  // - in the main room any other time the session is active
  // - no room when ended/draft
  const targetRoom = (() => {
    if (!participantName) return null;
    if (session.status === 'ended' || session.status === 'draft') return null;
    if (myAssignment?.roomName) {
      return { name: myAssignment.roomName, isPair: true, label: myAssignment.roomLabel };
    }
    if (session.main_room_name) {
      return { name: session.main_room_name, isPair: false, label: 'main room' };
    }
    return null;
  })();
  const targetName = targetRoom?.name || null;

  // ── daily call lifecycle ──
  // CRITICAL: we keep ONE call object for the whole component lifetime and switch
  // rooms with leave()+join() · NOT destroy()+createCallObject() per room.
  // daily allows only a single call-object instance per page, and destroy() is
  // async. the old "destroy then create" approach raced: createCallObject ran
  // before the previous instance finished tearing down and threw "Duplicate
  // DailyIframe instances are not allowed", which silently failed the join and
  // left people stuck on "connecting…" with no video and dead mic/cam buttons.
  const opChainRef = useRef(Promise.resolve());
  const joinedNameRef = useRef(null);

  // create the call object exactly once, reuse it for the whole session.
  useEffect(() => {
    let co = null;
    try {
      co = DailyIframe.getCallInstance() || DailyIframe.createCallObject({ videoSource: true, audioSource: true });
    } catch {
      // an instance already exists (e.g. a fast remount) · reuse it.
      co = DailyIframe.getCallInstance() || null;
    }
    if (co) setCallObject(co);
    return () => {
      joinedNameRef.current = null;
      if (co) {
        try { co.leave(); } catch {}
        try { co.destroy(); } catch {}
      }
    };
  }, []);

  // join / switch / leave rooms as targetRoom changes. operations are serialized
  // through a promise chain so two transitions never run on the call object at
  // once, and a `cancelled` flag drops superseded transitions.
  useEffect(() => {
    if (!callObject) return;
    let cancelled = false;
    const target = targetRoom;

    opChainRef.current = opChainRef.current.then(async () => {
      if (cancelled) return;

      // no room wanted (ended/draft) · leave if we're in one
      if (!target) {
        if (joinedNameRef.current) {
          await callObject.leave().catch(() => {});
          joinedNameRef.current = null;
          setCurrentRoom(null);
        }
        return;
      }

      // already in the right room
      if (joinedNameRef.current === target.name) return;

      // token for the target room
      const tokenRes = await fetch('/api/daily/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ roomName: target.name, userName: participantName, isOwner: false }),
      });
      if (cancelled || !tokenRes.ok) return;
      const { token, url } = await tokenRes.json();
      if (cancelled) return;

      // leave the current room first · daily can only join from new/left state.
      const state = callObject.meetingState();
      if (state !== 'new' && state !== 'left-meeting') {
        await callObject.leave().catch(() => {});
      }
      joinedNameRef.current = null;
      if (cancelled) return;

      await callObject.join({ url, token });
      if (cancelled) return;

      // explicitly enable local media after join · browsers don't reliably honor
      // videoSource/audioSource:true on the call object alone.
      try { await callObject.setLocalVideo(true); } catch (e) { console.warn('[daily] setLocalVideo failed', e); }
      try { await callObject.setLocalAudio(true); } catch (e) { console.warn('[daily] setLocalAudio failed', e); }
      // attempt daily's krisp noise cancellation; falls back to browser-native if not on plan
      try { await callObject.updateInputSettings({ audio: { processor: { type: 'noise-cancellation' } } }); } catch {}

      joinedNameRef.current = target.name;
      setCurrentRoom({ name: target.name, isPair: target.isPair });

      // brief "splitting" transition only when entering a pair room
      if (target.isPair && session.status === 'running_round') {
        setTransition('splitting');
        let n = 3;
        setTransitionCountdown(n);
        const tid = setInterval(() => {
          n--;
          if (n <= 0) { clearInterval(tid); setTransition(null); }
          else setTransitionCountdown(n);
        }, 1000);
      }
    }).catch((e) => { console.warn('[daily] room transition failed', e); });

    return () => { cancelled = true; };
  }, [callObject, targetName, participantName]); // eslint-disable-line

  // mark participant is_present=false AND destroy the daily call when they
  // navigate away or close the tab. destroy() synchronously tears down the
  // WebRTC connection so the camera/mic stop publishing immediately.
  // sendBeacon hits our server even after the tab closes.
  useEffect(() => {
    if (!participantId) return;
    const handler = () => {
      try {
        const blob = new Blob([JSON.stringify({})], { type: 'application/json' });
        navigator.sendBeacon(`/api/sessions/${initialSession.id}/leave`, blob);
      } catch {}
      // tear down daily so the camera/mic stop publishing immediately
      if (callObject) {
        try { callObject.leave(); } catch {}
        try { callObject.destroy(); } catch {}
      }
    };
    window.addEventListener('beforeunload', handler);
    window.addEventListener('pagehide', handler);
    return () => {
      window.removeEventListener('beforeunload', handler);
      window.removeEventListener('pagehide', handler);
    };
  }, [participantId, initialSession.id, callObject]);

  // ── render branches ──

  if (session.status === 'ended') {
    return <EndedView session={session} />;
  }

  // pair room
  if (callObject && currentRoom?.isPair && myAssignment) {
    return (
      <DailyProvider callObject={callObject}>
        <PairRoomView
          assignment={myAssignment}
          session={session}
          myName={participantName}
          transition={transition}
          transitionCountdown={transitionCountdown}
        />
      </DailyProvider>
    );
  }

  const isWithHost = Boolean(session.status === 'running_round' && myAssignment?.isWithHost);
  const isLateJoiner = Boolean(session.status === 'running_round' && !myAssignment);

  // build a name→profile lookup so video tiles can resolve linkedin from the daily user_name
  const participantsByName = participants.reduce((acc, p) => {
    if (p.name) acc[p.name] = p;
    return acc;
  }, {});

  // main room (with live video)
  if (callObject && !currentRoom?.isPair) {
    return (
      <DailyProvider callObject={callObject}>
        <MainRoomView
          session={session}
          participants={participants}
          participantsByName={participantsByName}
          myName={participantName}
          myId={participantId}
          isLateJoiner={isLateJoiner}
          isWithHost={isWithHost}
          withHostAssignment={isWithHost ? myAssignment : null}
          withVideo
        />
      </DailyProvider>
    );
  }

  // fallback: static main room (joining/loading or draft)
  return (
    <MainRoomView
      session={session}
      participants={participants}
      participantsByName={participantsByName}
      myName={participantName}
      myId={participantId}
      isLateJoiner={isLateJoiner}
      isWithHost={isWithHost}
      withHostAssignment={isWithHost ? myAssignment : null}
      withVideo={false}
    />
  );
}

// ============================================================================
// MAIN ROOM VIEW · works both with and without daily video
// ============================================================================
function MainRoomView({ session, participants, participantsByName, myName, myId, isLateJoiner, isWithHost, withHostAssignment, withVideo }) {
  const liveCount = participants.filter((p) => p.is_present).length;
  const isPreSession = session.status === 'live' || session.status === 'draft';
  const isClosing = session.status === 'closing';

  // when paired with the host, count down the round timer locally
  const [hostSecondsLeft, setHostSecondsLeft] = useState(withHostAssignment?.secondsRemaining || 0);
  useEffect(() => {
    if (!isWithHost) return;
    setHostSecondsLeft(Math.max(0, withHostAssignment?.secondsRemaining || 0));
    const id = setInterval(() => setHostSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [isWithHost, withHostAssignment?.pairingId]); // eslint-disable-line

  return (
    <main className="min-h-screen flex flex-col text-white" style={{ background: '#000' }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-800">
        <div className="display text-base">
          spread<span style={{ color: '#01ecf3' }}>*</span>good<span style={{ color: '#01ecf3' }}>*</span>chats
        </div>
        <div className="text-xs text-neutral-400">
          <span className="font-semibold" style={{ color: '#01ecf3' }}>{liveCount}</span> here · {session.name}
        </div>
      </header>

      {isLateJoiner && (
        <div className="px-6 py-2 text-center text-[11px] uppercase tracking-widest font-bold" style={{ background: 'rgba(1,236,243,0.15)', color: '#01ecf3' }}>
          * rounds in progress · you'll be folded in at the next reshuffle *
        </div>
      )}

      {isWithHost && (
        <div className="px-6 py-3 flex items-center justify-between gap-4 border-b border-neutral-800" style={{ background: 'rgba(1,236,243,0.1)' }}>
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: '#01ecf3' }}>* you're with the host this round *</div>
            {withHostAssignment?.prompt && (
              <div className="display text-base">{withHostAssignment.prompt}</div>
            )}
          </div>
          <div className="display text-3xl" style={{ color: hostSecondsLeft <= 30 ? '#fbbf24' : '#01ecf3' }}>
            {fmtTime(hostSecondsLeft)}
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr,360px] overflow-hidden">

        {/* gallery (video or static) */}
        <div className="p-6 overflow-y-auto">
          <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2 font-semibold">
            main room · everyone together
          </div>
          <div className="display text-3xl mb-6">
            {isPreSession
              ? <>welcome in.<br/>we'll start together.</>
              : isWithHost
                ? <>you're with<br/>the host this round.</>
                : isLateJoiner
                  ? <>hang tight.<br/>next round picks you up.</>
                  : isClosing
                    ? <>all rounds done.<br/>host is wrapping up.</>
                    : <>between rounds.<br/>nice work.</>}
          </div>

          {withVideo
            ? <MainRoomVideoGallery participantsByName={participantsByName} />
            : <MainRoomStaticGallery participants={participants} myId={myId} />}
        </div>

        {/* right rail */}
        <aside className="bg-neutral-950 border-l border-neutral-800 p-6 flex flex-col gap-4">
          <div className="rounded-md p-5" style={{ background: '#01ecf3', color: '#000' }}>
            <div className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-60">
              {isPreSession ? 'pre-session' : isWithHost ? 'this round' : isLateJoiner ? 'happening now' : isClosing ? 'closing out' : 'next up'}
            </div>
            <div className="display text-2xl mb-2">
              {isPreSession
                ? 'waiting for kickoff'
                : isWithHost
                  ? `round ${session.current_round} of ${session.rounds_total}`
                  : isLateJoiner
                    ? `round ${session.current_round} of ${session.rounds_total}`
                    : isClosing
                      ? `${session.rounds_total} rounds done`
                      : `round ${session.current_round + 1} of ${session.rounds_total}`}
            </div>
            <p className="text-sm">
              {isWithHost
                ? '[odd number this round · you get the host\'s full attention]'
                : isLateJoiner
                  ? '[others are paired up in breakouts · you\'ll join the next shuffle]'
                  : isClosing
                    ? '[stick around for the host\'s wrap-up · the call closes when they hit close out]'
                    : '[the host will kick things off · you\'ll get auto-paired]'}
            </p>
          </div>

          <div className="rounded-md bg-neutral-900 border border-neutral-800 p-4">
            <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2 font-semibold">about this session</div>
            <div className="text-sm text-neutral-300 space-y-2">
              <div className="flex justify-between"><span>rounds</span><span style={{ color: '#01ecf3' }}>{session.rounds_total}</span></div>
              <div className="flex justify-between"><span>per round</span><span style={{ color: '#01ecf3' }}>{Math.round(session.round_seconds / 60)} min</span></div>
              <div className="flex justify-between"><span>matching</span><span style={{ color: '#01ecf3' }}>random · no repeats</span></div>
            </div>
          </div>
        </aside>

      </div>

      {withVideo && <ParticipantControlBar sessionCode={session?.code} />}

      {!withVideo && (
        <footer className="border-t border-neutral-800 px-6 py-3 flex items-center justify-between">
          <div className="text-xs text-neutral-500">main room · everyone together</div>
          <button
            onClick={() => { if (confirm('leave this session?')) window.location.href = session?.code ? `/r/${session.code}` : '/'; }}
            className="text-sm border border-red-500 text-red-400 px-4 py-2 rounded font-semibold hover:bg-red-500 hover:text-white"
          >
            leave
          </button>
        </footer>
      )}
    </main>
  );
}

// daily-aware video gallery for main room
function MainRoomVideoGallery({ participantsByName }) {
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const ids = [localId, ...remoteIds].filter(Boolean);

  if (ids.length === 0) {
    return <div className="text-neutral-500 italic text-sm">[connecting to the main room...]</div>;
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
      {ids.map((id) => (
        <DailyVideoTile key={id} sessionId={id} isLocal={id === localId} participantsByName={participantsByName} />
      ))}
    </div>
  );
}

// fallback static avatar gallery
function MainRoomStaticGallery({ participants, myId }) {
  if (participants.length === 0) {
    return <div className="text-neutral-500 italic text-sm">[just you so far · others on the way]</div>;
  }
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {participants.map((p) => (
        <ParticipantTile key={p.id} name={p.name} isMe={p.id === myId} />
      ))}
    </div>
  );
}

// ============================================================================
// PAIR ROOM VIEW (mostly unchanged from prior version)
// ============================================================================
function PairRoomView({ assignment, session, myName, transition, transitionCountdown }) {
  const daily = useDaily();
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const [secondsLeft, setSecondsLeft] = useState(assignment.secondsRemaining || session.round_seconds);
  const [captured, setCaptured] = useState(false);

  useEffect(() => {
    setSecondsLeft(Math.max(0, assignment.secondsRemaining || 0));
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [assignment]);

  const wrapUp = secondsLeft <= 30 && secondsLeft > 0;

  if (transition === 'splitting') {
    return <SplittingTransition partnerName={assignment.partnerName} prompt={assignment.prompt} roomLabel={assignment.roomLabel} count={transitionCountdown} myName={myName} />;
  }

  async function handleCapture() {
    if (captured) return;
    try {
      const res = await fetch(`/api/sessions/${session.id}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          partnerName: assignment.partnerName,
          pairingId: assignment.pairingId,
        }),
      });
      if (res.ok) {
        setCaptured(true);
      } else {
        showToast("couldn't save · try again", 'error');
      }
    } catch {
      showToast('connection issue · try again', 'error');
    }
  }

  return (
    <main className="min-h-screen flex flex-col text-white" style={{ background: '#000' }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-800">
        <div className="flex items-center gap-3">
          <div className="display text-sm">round <span style={{ color: '#01ecf3' }}>{session.current_round}</span>/{session.rounds_total}</div>
          {wrapUp && <span className="text-xs uppercase tracking-widest font-bold animate-pulse" style={{ color: '#fbbf24' }}>* wrapping up</span>}
        </div>
        <div className="display text-3xl" style={{ color: wrapUp ? '#fbbf24' : '#01ecf3' }}>
          {fmtTime(secondsLeft)}
        </div>
        <div className="text-xs text-neutral-400">{assignment.roomLabel}</div>
      </header>

      <div className="px-6 py-4 border-b border-neutral-800 flex items-center justify-between gap-4" style={{ background: 'rgba(1,236,243,0.05)' }}>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: '#01ecf3' }}>this round's prompt</div>
          <div className="display text-xl">{assignment.prompt || '— [no prompt this round]'}</div>
        </div>
        <CaptureControl
          captured={captured}
          partnerName={assignment.partnerName}
          partnerLinkedinUrl={assignment.partnerLinkedinUrl}
          onCapture={handleCapture}
        />
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr,300px] overflow-hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 overflow-hidden">
          <DailyVideoTile sessionId={localId} isLocal nameOverride={myName} />
          {remoteIds.length > 0 ? (
            <DailyVideoTile sessionId={remoteIds[0]} cyan nameOverride={assignment.partnerName} linkedinOverride={assignment.partnerLinkedinUrl} />
          ) : (
            <div className="rounded-md bg-neutral-900 border-2 border-dashed border-neutral-700 flex items-center justify-center">
              <div className="text-center">
                <div className="display text-2xl mb-2">{assignment.partnerName}</div>
                <p className="text-sm text-neutral-500">[connecting · hang tight]</p>
              </div>
            </div>
          )}
        </div>
        <PairChatPanel myName={myName} />
      </div>

      <ParticipantControlBar sessionCode={session?.code} />
    </main>
  );
}

// ============================================================================
// capture control · pre-capture button + post-capture confirmation with linkedin CTA
// ============================================================================
function CaptureControl({ captured, partnerName, partnerLinkedinUrl, onCapture }) {
  const partnerFirst = (partnerName || '').split(' ')[0] || 'them';

  if (!captured) {
    return (
      <button
        onClick={onCapture}
        className="px-5 py-3 rounded font-semibold text-sm whitespace-nowrap btn-cyan"
      >
        capture this connection *
      </button>
    );
  }

  // post-capture: confirm + give them an immediate action when partner has linkedin
  return (
    <div className="flex items-center gap-3 whitespace-nowrap">
      <div className="text-xs uppercase tracking-widest font-bold flex items-center gap-1.5" style={{ color: '#01ecf3' }}>
        <span>✓</span><span>saved</span>
      </div>
      {partnerLinkedinUrl ? (
        <a
          href={partnerLinkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded font-semibold text-sm no-underline"
          style={{ background: '#0a66c2', color: '#fff' }}
        >
          <span>connect with {partnerFirst} on linkedin</span>
          <span>→</span>
        </a>
      ) : (
        <span className="text-xs text-neutral-400">[no linkedin shared · you'll see them in your recap]</span>
      )}
    </div>
  );
}

// ============================================================================
// PAIR ROOM CHAT · live messages between the two participants via daily app-message
// ============================================================================
function PairChatPanel({ myName }) {
  const daily = useDaily();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!daily) return;
    const handler = (event) => {
      const text = event?.data?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      setMessages((m) => [...m, {
        id: `${Date.now()}-${Math.random()}`,
        text: text.slice(0, 500),
        from: event?.data?.fromName || 'partner',
        isLocal: false,
      }]);
    };
    daily.on('app-message', handler);
    return () => { daily.off('app-message', handler); };
  }, [daily]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  function send(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || !daily) return;
    daily.sendAppMessage({ text, fromName: myName }, '*');
    setMessages((m) => [...m, {
      id: `${Date.now()}-${Math.random()}`,
      text,
      from: myName,
      isLocal: true,
    }]);
    setInput('');
  }

  return (
    <div className="hidden lg:flex flex-col border-l border-neutral-800 bg-neutral-950">
      <div className="px-3 py-2 border-b border-neutral-800 text-[10px] uppercase tracking-widest font-bold text-neutral-500">
        chat · just between you two
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && (
          <p className="text-xs text-neutral-600 italic">[share a link, drop a quick note, whatever feels useful]</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.isLocal ? 'text-right' : ''}>
            <div
              className={`inline-block px-3 py-2 rounded-md max-w-[85%] text-sm break-words text-left ${m.isLocal ? '' : 'bg-neutral-800 text-white'}`}
              style={m.isLocal ? { background: '#01ecf3', color: '#000' } : {}}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="p-3 border-t border-neutral-800 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="message..."
          maxLength={500}
          className="flex-1 bg-neutral-800 rounded px-3 py-2 text-base text-white border border-neutral-700 focus:outline-none focus:border-cyan-400"
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="px-3 py-2 rounded text-xs font-bold disabled:opacity-50"
          style={{ background: '#01ecf3', color: '#000' }}
        >
          send
        </button>
      </form>
    </div>
  );
}

// ============================================================================
// shared video tile component used by both pair room and main room
// ============================================================================
function DailyVideoTile({ sessionId, isLocal, cyan, nameOverride, linkedinOverride, participantsByName }) {
  const ref = useRef();
  const videoState = useMediaTrack(sessionId, 'video');
  const userName = useParticipantProperty(sessionId, 'user_name');
  const name = nameOverride || userName || (isLocal ? 'you' : 'guest');
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

  // resolve linkedin: explicit override wins, else lookup by name in main room gallery
  const linkedinUrl = linkedinOverride || participantsByName?.[name]?.linkedin_url || null;

  const isHostTile = name?.toLowerCase().includes('host') || (!isLocal && participantsByName?.[name]?.is_host);
  const borderStyle = (cyan || isHostTile)
    ? { border: '2px solid #01ecf3' }
    : { border: '1px solid #262626' };

  // pretty display name handling
  const displayName = isLocal
    ? `${name === 'host' || name === 'host (you)' ? 'you' : name} · you`
    : name;

  return (
    <div className="relative rounded-md overflow-hidden bg-neutral-900 aspect-video" style={borderStyle}>
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
      <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur px-2 py-1 rounded text-xs font-semibold flex items-center gap-2">
        <span>{displayName}</span>
        {linkedinUrl && !isLocal && (
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
      {isHostTile && !isLocal && (
        <div className="absolute top-2 left-2 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest rounded" style={{ background: '#01ecf3', color: '#000' }}>
          host
        </div>
      )}
    </div>
  );
}

// ============================================================================
// participant control bar (mic / cam / leave) · used wherever there's a daily call
// ============================================================================
function ParticipantControlBar({ sessionCode }) {
  const daily = useDaily();
  const localId = useLocalSessionId();
  const videoState = useMediaTrack(localId, 'video');
  const audioState = useMediaTrack(localId, 'audio');

  const videoOn = videoState?.state === 'sendable' || videoState?.state === 'playable';
  const audioOn = audioState?.state === 'sendable' || audioState?.state === 'playable';
  const videoBlocked = videoState?.state === 'blocked';

  async function toggleAudio() {
    if (!daily) return;
    try { await daily.setLocalAudio(!audioOn); } catch {}
  }
  async function toggleVideo() {
    if (!daily) return;
    // tapping here is a user gesture · this is what lets iOS Safari actually start the camera
    try { await daily.setLocalVideo(!videoOn); } catch (e) { console.warn('setLocalVideo failed', e); }
  }

  return (
    <footer className="border-t border-neutral-800 px-6 py-3 flex items-center justify-center gap-3 bg-black flex-wrap">
      <button
        onClick={toggleAudio}
        className={`px-4 py-2 rounded-full text-xs font-semibold border ${audioOn ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-red-900/30 border-red-700 text-red-300'}`}
      >
        {audioOn ? 'mic on' : 'mic off'}
      </button>
      <button
        onClick={toggleVideo}
        className={`px-4 py-2 rounded-full text-xs font-semibold border ${videoOn ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-red-900/30 border-red-700 text-red-300'}`}
        style={!videoOn ? { background: '#01ecf3', color: '#000', borderColor: '#01ecf3' } : {}}
      >
        {videoOn ? 'cam on' : (videoBlocked ? 'camera blocked · check browser settings' : 'tap to turn on camera')}
      </button>
      <button
        onClick={() => { if (confirm('leave this session?')) window.location.href = sessionCode ? `/r/${sessionCode}` : '/'; }}
        className="px-4 py-2 rounded-full text-xs font-semibold border border-red-500 text-red-400 hover:bg-red-500 hover:text-white"
      >
        leave
      </button>
    </footer>
  );
}

// ============================================================================
// SPLITTING TRANSITION (unchanged)
// ============================================================================
function SplittingTransition({ partnerName, prompt, roomLabel, count, myName }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center text-white relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at center, #001a1a 0%, #000 70%)' }}>
      <div className="absolute top-20 text-xs uppercase tracking-[0.3em] font-bold" style={{ color: '#01ecf3' }}>pairing up</div>

      <div className="text-center mb-8">
        <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2 font-semibold">you're with</div>
        <div className="display text-6xl">
          {partnerName?.split(' ')[0] || partnerName} <span style={{ color: '#01ecf3' }}>*</span>
        </div>
      </div>

      <div className="flex items-center gap-8 mb-12">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center display text-3xl text-black border-2 border-black"
          style={{ background: '#01ecf3', boxShadow: '4px 4px 0 #01ecf3' }}
        >
          {initials(myName)}
        </div>
        <div className="display text-2xl animate-pulse" style={{ color: '#01ecf3' }}>→ ←</div>
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center display text-3xl text-black border-2 border-black"
          style={{ background: colorForName(partnerName), boxShadow: '4px 4px 0 #01ecf3' }}
        >
          {initials(partnerName || '')}
        </div>
      </div>

      <div className="text-center">
        <div className="text-xs uppercase tracking-widest text-neutral-500 font-semibold mb-2">opening room in</div>
        <div className="display text-9xl" style={{ color: '#01ecf3' }}>{count || '*'}</div>
        {roomLabel && <div className="text-sm text-neutral-500 mt-4">your room: <span style={{ color: '#01ecf3' }}>* {roomLabel} *</span></div>}
      </div>

      {prompt && (
        <div className="mt-8 max-w-md text-center px-5 py-3 rounded" style={{ background: 'rgba(1,236,243,0.1)', border: '1px solid rgba(1,236,243,0.3)' }}>
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: '#01ecf3' }}>this round's prompt</div>
          <div className="display text-base">{prompt}</div>
        </div>
      )}
    </main>
  );
}

// ============================================================================
// ENDED VIEW · participant recap with their captures
// ============================================================================
function EndedView({ session }) {
  const [recap, setRecap] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sessions/${session.id}/recap`, { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (!cancelled) { setRecap(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session.id]);

  return (
    <main className="min-h-screen p-6 md:p-12" style={{ background: '#01ecf3', color: '#000' }}>
      <div className="max-w-2xl mx-auto">
        <div className="display text-5xl md:text-7xl mb-4">that's a wrap.</div>
        <p className="text-lg mb-1">good chats happened.</p>

        {loading && <p className="text-sm opacity-70 mt-6">[pulling your recap...]</p>}

        {!loading && recap && (
          <div className="mt-8 space-y-6">

            {/* stats row */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-black text-white rounded-md p-4">
                <div className="display text-3xl">{recap.captures.length}</div>
                <div className="text-[10px] uppercase tracking-widest font-bold mt-1 opacity-60" style={{ color: '#01ecf3' }}>you captured</div>
              </div>
              <div className="bg-black text-white rounded-md p-4">
                <div className="display text-3xl">{recap.captured_by_count}</div>
                <div className="text-[10px] uppercase tracking-widest font-bold mt-1 opacity-60" style={{ color: '#01ecf3' }}>captured you</div>
              </div>
              <div className="bg-black text-white rounded-md p-4">
                <div className="display text-3xl">{recap.mutual_capture_count}</div>
                <div className="text-[10px] uppercase tracking-widest font-bold mt-1 opacity-60" style={{ color: '#01ecf3' }}>mutual</div>
              </div>
            </div>

            {/* captures list */}
            {recap.captures.length > 0 ? (
              <div className="bg-white rounded-md p-5 sticker">
                <div className="text-[10px] uppercase tracking-widest font-bold mb-3 text-neutral-500">people you wanted to stay in touch with</div>
                <ul className="divide-y divide-neutral-200">
                  {recap.captures.map((c) => (
                    <li key={c.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold truncate">{c.captured_name}</div>
                        {c.captured_email && <div className="text-xs text-neutral-500 truncate">{c.captured_email}</div>}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {c.captured_linkedin_url && (
                          <a
                            href={c.captured_linkedin_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold no-underline"
                            style={{ background: '#0a66c2', color: '#fff' }}
                          >
                            <span>linkedin</span><span>→</span>
                          </a>
                        )}
                        {c.captured_email && (
                          <a
                            href={`mailto:${c.captured_email}?subject=Great chatting at WAFG Spread Good Chats`}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded text-xs font-bold no-underline border-2 border-black"
                            style={{ background: '#fff', color: '#000' }}
                          >
                            <span>email</span><span>→</span>
                          </a>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-neutral-500 mt-4">
                  [screenshot or save this list · the page closes when you navigate away]
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-md p-5 sticker">
                <div className="font-semibold">no captures this time.</div>
                <p className="text-sm text-neutral-600 mt-1">[next session, tap the heart on someone you want to stay in touch with]</p>
              </div>
            )}
          </div>
        )}

        <p className="script text-3xl mt-10">what starts here, ripples →</p>
        <a href="/" className="inline-block mt-8 underline text-sm">close out</a>
      </div>
    </main>
  );
}

// ============================================================================
// shared static participant tile (for fallback no-video state)
// ============================================================================
function ParticipantTile({ name, isMe }) {
  return (
    <div className="relative aspect-[4/3] bg-neutral-900 border border-neutral-800 rounded-md overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-12 h-12 display rounded-full flex items-center justify-center text-black text-base" style={{ background: colorForName(name || '') }}>
          {initials(name || '')}
        </div>
      </div>
      <div className="absolute bottom-1.5 left-1.5 bg-black/70 px-1.5 py-0.5 rounded text-[11px]">{name} {isMe && '· you'}</div>
    </div>
  );
}

// ============================================================================
// utils
// ============================================================================
function fmtTime(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
