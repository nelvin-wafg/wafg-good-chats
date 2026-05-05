'use client';
import { useEffect, useRef, useState } from 'react';
import { DailyProvider, useDaily, useParticipantIds, useLocalSessionId } from '@daily-co/daily-react';
import DailyIframe from '@daily-co/daily-js';
import { colorForName, initials } from '@/lib/brand';

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

  // call lifecycle: join targetRoom, leave when it changes / unmounts.
  useEffect(() => {
    let mounted = true;
    async function manageCall() {
      if (!targetRoom) {
        if (callObject) {
          await callObject.leave().catch(() => {});
          callObject.destroy();
          setCallObject(null);
          setCurrentRoom(null);
        }
        return;
      }
      if (currentRoom?.name === targetRoom.name) return; // already there

      // get token
      const tokenRes = await fetch('/api/daily/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          roomName: targetRoom.name,
          userName: participantName,
          isOwner: false,
        }),
      });
      if (!tokenRes.ok) return;
      const { token, url } = await tokenRes.json();
      if (!mounted) return;

      // tear down old call
      if (callObject) {
        await callObject.leave().catch(() => {});
        callObject.destroy();
      }

      const co = DailyIframe.createCallObject({ videoSource: true, audioSource: true });
      await co.join({ url, token });
      if (!mounted) { co.destroy(); return; }
      setCallObject(co);
      setCurrentRoom({ name: targetRoom.name, isPair: targetRoom.isPair });

      // brief "splitting" transition only when entering a pair room
      if (targetRoom.isPair && session.status === 'running_round') {
        setTransition('splitting');
        let n = 3;
        setTransitionCountdown(n);
        const tid = setInterval(() => {
          n--;
          if (n <= 0) {
            clearInterval(tid);
            setTransition(null);
          } else {
            setTransitionCountdown(n);
          }
        }, 1000);
      }
    }
    manageCall();
    return () => { mounted = false; };
  }, [targetName, participantName]); // eslint-disable-line

  // cleanup on unmount
  useEffect(() => {
    return () => {
      if (callObject) {
        callObject.leave().catch(() => {});
        callObject.destroy();
      }
    };
  }, [callObject]);

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

  // main room (with live video)
  if (callObject && !currentRoom?.isPair) {
    return (
      <DailyProvider callObject={callObject}>
        <MainRoomView
          session={session}
          participants={participants}
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
function MainRoomView({ session, participants, myName, myId, isLateJoiner, isWithHost, withHostAssignment, withVideo }) {
  const liveCount = participants.filter((p) => p.is_present).length;
  const isPreSession = session.status === 'live' || session.status === 'draft';

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
                ? <>1-on-1 with the host.<br/>your round, your rules.</>
                : isLateJoiner
                  ? <>hang tight.<br/>next round picks you up.</>
                  : <>between rounds.<br/>nice work.</>}
          </div>

          {withVideo
            ? <MainRoomVideoGallery />
            : <MainRoomStaticGallery participants={participants} myId={myId} />}
        </div>

        {/* right rail */}
        <aside className="bg-neutral-950 border-l border-neutral-800 p-6 flex flex-col gap-4">
          <div className="rounded-md p-5" style={{ background: '#01ecf3', color: '#000' }}>
            <div className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-60">
              {isPreSession ? 'pre-session' : isWithHost ? 'this round' : isLateJoiner ? 'happening now' : 'next up'}
            </div>
            <div className="display text-2xl mb-2">
              {isPreSession
                ? 'waiting for kickoff'
                : isWithHost
                  ? `round ${session.current_round} of ${session.rounds_total}`
                  : isLateJoiner
                    ? `round ${session.current_round} of ${session.rounds_total}`
                    : `round ${session.current_round + 1} of ${session.rounds_total}`}
            </div>
            <p className="text-sm">
              {isWithHost
                ? '[odd number this round · you get the host\'s full attention]'
                : isLateJoiner
                  ? '[others are paired up in breakouts · you\'ll join the next shuffle]'
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

      {withVideo && <ParticipantControlBar />}

      {!withVideo && (
        <footer className="border-t border-neutral-800 px-6 py-3 flex items-center justify-between">
          <div className="text-xs text-neutral-500">main room · everyone together</div>
          <button
            onClick={() => { if (confirm('leave this session?')) window.location.href = '/'; }}
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
function MainRoomVideoGallery() {
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const ids = [localId, ...remoteIds].filter(Boolean);

  if (ids.length === 0) {
    return <div className="text-neutral-500 italic text-sm">[connecting to the main room...]</div>;
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
      {ids.map((id) => (
        <DailyVideoTile key={id} sessionId={id} isLocal={id === localId} />
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
      await fetch(`/api/sessions/${session.id}/capture`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          partnerName: assignment.partnerName,
          pairingId: assignment.pairingId,
        }),
      });
      setCaptured(true);
    } catch {}
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
        <button
          onClick={handleCapture}
          disabled={captured}
          className={`px-5 py-3 rounded font-semibold text-sm whitespace-nowrap ${captured ? 'bg-neutral-700 text-neutral-400' : 'btn-cyan'}`}
        >
          {captured ? '* captured' : 'capture this connection *'}
        </button>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
        <DailyVideoTile sessionId={localId} isLocal nameOverride={myName} />
        {remoteIds.length > 0 ? (
          <DailyVideoTile sessionId={remoteIds[0]} cyan nameOverride={assignment.partnerName} />
        ) : (
          <div className="rounded-md bg-neutral-900 border-2 border-dashed border-neutral-700 flex items-center justify-center">
            <div className="text-center">
              <div className="display text-2xl mb-2">{assignment.partnerName}</div>
              <p className="text-sm text-neutral-500">[connecting · hang tight]</p>
            </div>
          </div>
        )}
      </div>

      <ParticipantControlBar />
    </main>
  );
}

// ============================================================================
// shared video tile component used by both pair room and main room
// ============================================================================
function DailyVideoTile({ sessionId, isLocal, cyan, nameOverride }) {
  const ref = useRef();
  const daily = useDaily();
  const [name, setName] = useState(nameOverride || (isLocal ? 'you' : ''));
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (!daily || !ref.current) return;
    const update = () => {
      const p = daily.participants()[sessionId];
      if (!p) return;
      const userName = nameOverride || p.user_name || (isLocal ? 'you' : 'guest');
      setName(userName);
      const track = p.tracks?.video?.persistentTrack;
      if (track) {
        ref.current.srcObject = new MediaStream([track]);
        setHasVideo(true);
      } else {
        setHasVideo(false);
      }
    };
    update();
    daily.on('participant-updated', update);
    daily.on('track-started', update);
    daily.on('track-stopped', update);
    return () => {
      daily.off('participant-updated', update);
      daily.off('track-started', update);
      daily.off('track-stopped', update);
    };
  }, [daily, sessionId, isLocal, nameOverride]);

  const isHostTile = name?.toLowerCase().startsWith('host');
  const borderStyle = (cyan || isHostTile)
    ? { border: '2px solid #01ecf3' }
    : { border: '1px solid #262626' };

  return (
    <div className="relative rounded-md overflow-hidden bg-neutral-900 aspect-video" style={borderStyle}>
      <video ref={ref} autoPlay playsInline muted={isLocal} className="w-full h-full object-cover" />
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
      <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur px-2 py-1 rounded text-xs font-semibold">
        {name} {isLocal && <span className="text-neutral-400">· you</span>}
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
function ParticipantControlBar() {
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
    <footer className="border-t border-neutral-800 px-6 py-3 flex items-center justify-center gap-3 bg-black">
      <button
        onClick={toggleAudio}
        className={`px-4 py-2 rounded-full text-xs font-semibold border ${audioOn ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-red-900/30 border-red-700 text-red-300'}`}
      >
        {audioOn ? 'mic on' : 'mic off'}
      </button>
      <button
        onClick={toggleVideo}
        className={`px-4 py-2 rounded-full text-xs font-semibold border ${videoOn ? 'bg-neutral-800 border-neutral-700 text-white' : 'bg-red-900/30 border-red-700 text-red-300'}`}
      >
        {videoOn ? 'cam on' : 'cam off'}
      </button>
      <button
        onClick={() => { if (confirm('leave this session?')) window.location.href = '/'; }}
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
// ENDED VIEW (unchanged)
// ============================================================================
function EndedView({ session }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8" style={{ background: '#01ecf3', color: '#000' }}>
      <div className="max-w-xl text-center">
        <div className="display text-7xl mb-4">that's a wrap.</div>
        <p className="text-lg mb-2">good chats happened. {session.rounds_total} rounds, just like that.</p>
        <p className="script text-3xl mt-4">what starts here, ripples →</p>
        <p className="text-sm mt-12 opacity-70">[your captures + a recap will hit your inbox if we have it]</p>
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
