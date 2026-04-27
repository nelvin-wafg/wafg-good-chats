'use client';
import { useEffect, useRef, useState } from 'react';
import { DailyProvider, useDaily, useParticipantIds, useLocalSessionId } from '@daily-co/daily-react';
import DailyIframe from '@daily-co/daily-js';
import { colorForName, initials } from '@/lib/brand';

// the heart of the participant experience.
// state machine: lobby -> main_room -> splitting -> pair_room -> returning -> main_room -> ... -> ended
//
// session state from the server drives this; we poll every 2s.
// when state says "running_round", we join our pair room. when it changes to "between_rounds" or "live", we go back to main.

export default function RoomExperience({ session: initialSession }) {
  const [participantId, setParticipantId] = useState(null);
  const [participantName, setParticipantName] = useState(null);
  const [session, setSession] = useState(initialSession);
  const [myAssignment, setMyAssignment] = useState(null); // { roomName, partnerName, prompt, secondsRemaining }
  const [participants, setParticipants] = useState([]);
  const [transition, setTransition] = useState(null); // null | "splitting" | "returning"
  const [transitionCountdown, setTransitionCountdown] = useState(0);
  const [callObject, setCallObject] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null); // { name, url, token }

  // load participant name (for UI display only) from sessionStorage.
  // the *authoritative* identity comes from the HttpOnly cookie set by /join.
  // server reads cookie on every state poll; we get our id back from data.me.
  useEffect(() => {
    try {
      const pname = window.sessionStorage.getItem(`pname:${initialSession.id}`);
      if (!pname) {
        // no name in storage means we never joined this session in this browser
        window.location.href = `/r/${initialSession.code}`;
        return;
      }
      setParticipantName(pname);
    } catch {}
  }, [initialSession]);

  // poll session state every 2 seconds. server identifies us via HttpOnly cookie.
  useEffect(() => {
    let cancelled = false;
    let consecutiveUnauthed = 0;
    async function poll() {
      try {
        const res = await fetch(`/api/sessions/${initialSession.id}/state`, {
          credentials: 'same-origin',
        });
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
          // server doesn't recognize us → cookie is missing or expired.
          // bounce back to join after a couple consecutive failures.
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

  // when assignment changes (new room to join), tear down old call and join new
  useEffect(() => {
    let mounted = true;
    async function joinRoom() {
      if (!myAssignment?.roomName || !participantName) {
        // we're not assigned to anything → in main room or waiting
        if (callObject) {
          await callObject.leave().catch(() => {});
          callObject.destroy();
          setCallObject(null);
          setCurrentRoom(null);
        }
        return;
      }
      // already in this room?
      if (currentRoom?.name === myAssignment.roomName) return;

      // get token
      const tokenRes = await fetch(`/api/daily/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomName: myAssignment.roomName,
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

      // create new call object
      const co = DailyIframe.createCallObject({
        videoSource: true,
        audioSource: true,
      });
      await co.join({ url, token });
      if (!mounted) { co.destroy(); return; }
      setCallObject(co);
      setCurrentRoom({ name: myAssignment.roomName, url, token });

      // brief "splitting" transition when entering a pair room
      if (session.status === 'running_round') {
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
    joinRoom();
    return () => { mounted = false; };
  }, [myAssignment, participantName, session.status]); // eslint-disable-line

  // cleanup
  useEffect(() => {
    return () => {
      if (callObject) {
        callObject.leave().catch(() => {});
        callObject.destroy();
      }
    };
  }, [callObject]);

  // ENDED state
  if (session.status === 'ended') {
    return <EndedView session={session} />;
  }

  // LATE JOINER state: session is running rounds but we have no assignment yet
  if (session.status === 'running_round' && !myAssignment) {
    return <LateJoinerView session={session} participants={participants} myName={participantName} />;
  }

  // we're in a pair room
  if (myAssignment?.roomName && callObject) {
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

  // default: main room (lobby pre-session, or between rounds)
  return <MainRoomView session={session} participants={participants} myName={participantName} myId={participantId} />;
}

// ============================================================================
// MAIN ROOM VIEW
// ============================================================================
function MainRoomView({ session, participants, myName, myId }) {
  const liveCount = participants.filter((p) => p.is_present).length;
  const isPreSession = session.status === 'live' || session.status === 'draft';

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

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr,360px]">

        {/* gallery */}
        <div className="p-6 overflow-y-auto">
          <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2 font-semibold">main room · everyone together</div>
          <div className="display text-3xl mb-6">
            {isPreSession ? <>welcome in.<br/>we'll start together.</> : <>between rounds.<br/>nice work.</>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {participants.map((p) => (
              <ParticipantTile key={p.id} name={p.name} isHost={p.metadata?.isHost} isMe={p.id === myId} />
            ))}
            {participants.length === 0 && (
              <div className="col-span-full text-neutral-500 italic text-sm">[just you so far · others on the way]</div>
            )}
          </div>
        </div>

        {/* right rail */}
        <aside className="bg-neutral-950 border-l border-neutral-800 p-6 flex flex-col gap-4">
          <div className="rounded-md p-5" style={{ background: '#01ecf3', color: '#000' }}>
            <div className="text-[10px] uppercase tracking-widest font-bold mb-2 opacity-60">
              {isPreSession ? 'pre-session' : 'next up'}
            </div>
            <div className="display text-2xl mb-2">
              {isPreSession ? 'waiting for kickoff' : `round ${session.current_round + 1} of ${session.rounds_total}`}
            </div>
            <p className="text-sm">
              [the host will start things off · 5 min per round · you'll get auto-paired]
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

      <footer className="border-t border-neutral-800 px-6 py-3 flex items-center justify-between">
        <div className="text-xs text-neutral-500">main room · everyone together</div>
        <button
          onClick={() => { if (confirm('leave this session?')) window.location.href = '/'; }}
          className="text-sm border border-red-500 text-red-400 px-4 py-2 rounded font-semibold hover:bg-red-500 hover:text-white"
        >
          leave
        </button>
      </footer>
    </main>
  );
}

// ============================================================================
// PAIR ROOM VIEW
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
      {/* top bar */}
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

      {/* prompt + capture */}
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

      {/* video tiles */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
        <VideoTile sessionId={localId} name={myName} isLocal />
        {remoteIds.length > 0 ? (
          <VideoTile sessionId={remoteIds[0]} name={assignment.partnerName} cyan />
        ) : (
          <div className="rounded-md bg-neutral-900 border-2 border-dashed border-neutral-700 flex items-center justify-center">
            <div className="text-center">
              <div className="display text-2xl mb-2">{assignment.partnerName}</div>
              <p className="text-sm text-neutral-500">[connecting · hang tight]</p>
            </div>
          </div>
        )}
      </div>

      {/* bottom controls */}
      <footer className="border-t border-neutral-800 px-6 py-3 flex items-center justify-center gap-3">
        <ControlButton onClick={() => daily?.setLocalAudio(!daily?.localAudio())} label="mic" />
        <ControlButton onClick={() => daily?.setLocalVideo(!daily?.localVideo())} label="cam" />
      </footer>
    </main>
  );
}

function VideoTile({ sessionId, name, isLocal, cyan }) {
  const ref = useRef();
  const daily = useDaily();
  useEffect(() => {
    if (!daily || !ref.current) return;
    const update = () => {
      const p = daily.participants()[sessionId];
      if (!p) return;
      const stream = p.tracks?.video?.persistentTrack;
      if (stream) {
        ref.current.srcObject = new MediaStream([stream]);
      }
    };
    update();
    daily.on('participant-updated', update);
    daily.on('track-started', update);
    return () => {
      daily.off('participant-updated', update);
      daily.off('track-started', update);
    };
  }, [daily, sessionId]);

  const borderClass = cyan ? 'border-2' : 'border';
  const borderStyle = cyan ? { borderColor: '#01ecf3' } : { borderColor: '#262626' };

  return (
    <div className={`relative rounded-md ${borderClass} overflow-hidden bg-neutral-900`} style={borderStyle}>
      <video ref={ref} autoPlay playsInline muted={isLocal} className="w-full h-full object-cover" />
      <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur px-2 py-1 rounded text-sm font-semibold">
        {name} {isLocal && <span className="text-neutral-400 text-xs">· you</span>}
      </div>
    </div>
  );
}

function ControlButton({ onClick, label }) {
  return (
    <button
      onClick={onClick}
      className="w-11 h-11 bg-neutral-800 border border-neutral-700 rounded-full hover:bg-neutral-700 text-white"
      title={label}
    >
      {label === 'mic' ? '🎤' : '📹'}
    </button>
  );
}

// ============================================================================
// TRANSITIONS
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
// LATE JOINER VIEW
// ============================================================================
function LateJoinerView({ session, participants, myName }) {
  return (
    <main className="min-h-screen flex text-white" style={{ background: 'linear-gradient(135deg,#0a0a0a 0%,#1a1a1a 100%)' }}>
      <div className="flex-1 flex flex-col justify-center p-12">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs uppercase tracking-widest font-semibold w-fit mb-6" style={{ background: 'rgba(1,236,243,0.1)', border: '1px solid rgba(1,236,243,0.3)', color: '#01ecf3' }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#01ecf3' }}></span>
          rounds in progress
        </div>
        <div className="display text-6xl mb-4">
          hey {myName?.split(' ')[0] || 'there'} <span style={{ color: '#01ecf3' }}>*</span><br/>perfect timing.
        </div>
        <p className="text-base text-neutral-400 max-w-md mb-8">
          everyone's mid-conversation right now · round <strong style={{ color: '#01ecf3' }}>{session.current_round} of {session.rounds_total}</strong> happening in pairs. you'll get folded in at the next reshuffle.
        </p>
        <div className="rounded-md p-5 w-fit" style={{ background: '#01ecf3', color: '#000', border: '2px solid #000', boxShadow: '6px 6px 0 #000' }}>
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1 opacity-60">your match opens at</div>
          <div className="display text-3xl">next round</div>
        </div>
        <p className="text-sm text-neutral-600 mt-8 max-w-md">
          [we'll auto-pair you · you won't sit out longer than this round]
        </p>
      </div>

      <aside className="w-96 bg-black/50 border-l border-neutral-800 p-6 flex flex-col gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2 font-semibold">{participants.filter((p) => p.is_present).length} folks here</div>
          <div className="grid grid-cols-3 gap-2">
            {participants.filter((p) => p.is_present).slice(0, 12).map((p) => (
              <div key={p.id} className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full display flex items-center justify-center text-black text-base" style={{ background: colorForName(p.name) }}>
                  {initials(p.name)}
                </div>
                <div className="text-[10px] mt-1 text-neutral-400 truncate">{p.name?.split(' ')[0]}</div>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}

// ============================================================================
// ENDED VIEW
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
// shared participant tile
// ============================================================================
function ParticipantTile({ name, isHost, isMe }) {
  return (
    <div className="relative aspect-[4/3] bg-neutral-900 border border-neutral-800 rounded-md overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-12 h-12 display rounded-full flex items-center justify-center text-black text-base" style={{ background: colorForName(name || '') }}>
          {initials(name || '')}
        </div>
      </div>
      <div className="absolute bottom-1.5 left-1.5 bg-black/70 px-1.5 py-0.5 rounded text-[11px]">{name} {isMe && '· you'}</div>
      {isHost && <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest text-black" style={{ background: '#01ecf3' }}>host</div>}
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
