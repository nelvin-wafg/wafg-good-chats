'use client';
import { useEffect, useRef, useState } from 'react';
import { DailyProvider, DailyAudio, useDaily, useParticipantIds, useLocalSessionId, useMediaTrack, useParticipantProperty, useActiveSpeakerId } from '@daily-co/daily-react';
import DailyIframe from '@daily-co/daily-js';
import { colorForName, initials } from '@/lib/brand';
import { networkQualityPayload, isNetworkStateChange } from '@/lib/network-diag';
import { showToast } from '@/components/Toast';
import ChatPanel from '@/components/ChatPanel';
import DeviceMenu from '@/components/DeviceMenu';
import ViewModeToggle from '@/components/ViewModeToggle';

// iOS Safari blocks remote audio playback until the user has interacted with the
// page in a way that unlocks the audio context. DailyAudio handles autoplay on
// most browsers but iOS needs an explicit nudge. we call this on the first
// participant gesture (any control bar tap) and reuse the unlocked context for
// the rest of the session. also force-plays any current <audio> elements in case
// a fresh batch was created after a room switch.
let _audioCtx = null;
function unlockIosAudio() {
  try {
    if (typeof window === 'undefined') return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx && !_audioCtx) {
      _audioCtx = new Ctx();
      const buf = _audioCtx.createBuffer(1, 1, 22050);
      const src = _audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(_audioCtx.destination);
      src.start(0);
    }
    if (_audioCtx && _audioCtx.state === 'suspended') {
      _audioCtx.resume().catch(() => {});
    }
    if (typeof document !== 'undefined') {
      document.querySelectorAll('audio').forEach((a) => {
        try { a.play().catch(() => {}); } catch {}
      });
    }
  } catch {}
}

// fire-and-forget WebRTC connection-health logging: turns "someone couldn't
// hear anyone" into a lookup the host can do afterward instead of a mystery.
// always console.logs too, for anyone actively watching devtools live.
// keepalive:true so the request has a chance to land even if the tab is in
// the middle of navigating away right as a connection drops.
function reportDiagnostic(sessionId, eventType, payload, subjectParticipantId) {
  try { console.log('[diagnostics]', eventType, payload); } catch {}
  try {
    fetch(`/api/sessions/${sessionId}/diagnostics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      keepalive: true,
      body: JSON.stringify({ eventType, payload, subjectParticipantId }),
    }).catch(() => {});
  } catch {}
}

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
  const sessionRef = useRef(initialSession);
  const [myAssignment, setMyAssignment] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [transition, setTransition] = useState(null); // null | "splitting"
  const [transitionCountdown, setTransitionCountdown] = useState(0);
  const [callObject, setCallObject] = useState(null);
  const [currentRoom, setCurrentRoom] = useState(null); // { name, isPair }
  const [showEdit, setShowEdit] = useState(false);
  const [directMessage, setDirectMessage] = useState(null);
  const [broadcast, setBroadcast] = useState(null);
  const [showFlagComposer, setShowFlagComposer] = useState(false);
  // admission gates the waiting room. undefined = we don't know yet (first poll
  // hasn't landed); false = waiting; true = host has admitted us OR rounds started.
  const [admitted, setAdmitted] = useState(undefined);

  // my linkedin (from the poll's participant row) · used to prefill the edit modal
  const myParticipantRow = participants.find((p) => p.id === participantId) || null;
  const myLinkedin = myParticipantRow?.linkedin_url || null;
  const myAvatarUrl = myParticipantRow?.avatar_url || null;
  const isOrphaned = Boolean(session.status === 'running_round' && myAssignment?.orphaned);
  const orphanedFromName = isOrphaned ? myAssignment?.partnerName : null;

  function dismissDirectMessage() {
    if (directMessage?.at) dismissedDirectMessagesRef.current.add(directMessage.at);
    setDirectMessage(null);
  }
  // one-tap consent for a host's "can you unmute?" request. the host can ask,
  // but only the participant turns their own mic back on.
  async function unmuteSelf() {
    unlockIosAudio();
    try { await callObject?.setLocalAudio(true); } catch (e) { console.warn('[unmute] failed', e); }
    dismissDirectMessage();
  }
  // submit a flag · optional `text` is the participant's note to the host
  // (used both for initial flags and for replies to a host message).
  async function sendFlag(text) {
    try {
      const res = await fetch(`/api/sessions/${initialSession.id}/flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ text: text || null }),
      });
      if (res.ok) {
        showToast('sent · the host will see it', 'success');
        return true;
      }
      showToast((await res.text()) || "couldn't send · try again", 'error');
      return false;
    } catch {
      showToast('connection issue · try again', 'error');
      return false;
    }
  }

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
        const updated = { ...sessionRef.current, ...data.session };
        sessionRef.current = updated;
        setSession(updated);
        setMyAssignment(data.assignment || null);
        setParticipants(data.participants || []);
        // direct message from host · keep showing until participant dismisses.
        // we track dismissed timestamps locally so a redelivery from the next
        // poll doesn't re-pop a message the participant already closed.
        const dm = data.directMessage;
        if (dm?.text && dm?.at) {
          if (!dismissedDirectMessagesRef.current.has(dm.at)) {
            setDirectMessage((cur) => (cur?.at === dm.at ? cur : dm));
          }
        } else {
          setDirectMessage(null);
        }
        // broadcast: server only returns it within ~15s of send, so it self-clears.
        if (data.broadcast?.text && data.broadcast?.at) {
          setBroadcast((cur) => (cur?.at === data.broadcast.at ? cur : data.broadcast));
        } else {
          setBroadcast(null);
        }
        if (data.me?.participantId) {
          // host explicitly kicked us · this covers the case where we were never
          // actually connected to the Daily call (so the 'left-meeting'-based
          // eject detection below never fires) — e.g. a stale tab that only ever
          // polled state without joining. redirect the same way a real eject does.
          if (data.me.kicked) {
            cancelled = true;
            window.location.href = `/r/${initialSession.code}?removed=1`;
            return;
          }
          setParticipantId(data.me.participantId);
          setAdmitted(Boolean(data.me.admitted));
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
    // waiting room: don't join Daily until the host admits us. once admitted
    // becomes true the next render picks up the right room and joins.
    if (admitted === false) return null;
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
  // intentionalLeaveRef tracks whether the next 'left-meeting' is one WE caused
  // (room switch / unmount) vs one caused by the host kicking us. when false at
  // the moment 'left-meeting' fires, we treat it as an eject and bounce.
  const intentionalLeaveRef = useRef(false);
  // remember which direct-message timestamps the participant has dismissed, so
  // they don't re-pop on every state poll.
  const dismissedDirectMessagesRef = useRef(new Set());
  // bumped by the left-meeting handler below to force a rejoin attempt after
  // an unintentional disconnect, even though targetRoom/targetName haven't
  // changed (we're still supposed to be in the same room).
  const [reconnectNonce, setReconnectNonce] = useState(0);

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
      // we're going away · any 'left-meeting' that fires here is ours, not a kick.
      intentionalLeaveRef.current = true;
      joinedNameRef.current = null;
      if (co) {
        try { co.leave(); } catch {}
        try { co.destroy(); } catch {}
      }
    };
  }, []);

  // root-cause fix for "can't hear my partner until I leave and rejoin": DailyAudio
  // mounts a fresh <audio> element per remote participant whenever their track
  // arrives, which after a room switch can land well after our one-shot, blindly-
  // timed setTimeout(unlockIosAudio, 500) below has already fired — under real
  // event load (many simultaneous room switches renegotiating at once) that race
  // is lost often enough to matter. rather than guess a timing window, watch the
  // DOM directly and force-play every <audio> element the instant it actually
  // appears, whenever that is. this runs for the whole component lifetime, not
  // just around a room switch, so it also covers audio elements created for
  // participants whose tracks arrive late in the room we're already in.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return;
    function tryPlay(el) {
      try { el.play().catch(() => {}); } catch {}
    }
    document.querySelectorAll('audio').forEach(tryPlay);
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.tagName === 'AUDIO') tryPlay(node);
          else if (node.querySelectorAll) node.querySelectorAll('audio').forEach(tryPlay);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  // connection diagnostics: report this participant's OWN network quality and
  // connection-state changes (see lib note on the /diagnostics route). this is
  // the data that turns "I couldn't hear anyone, tried everything" into a real
  // answer — e.g. confirming their connection never stabilized at all, which
  // points at their network/firewall rather than anything in this app.
  useEffect(() => {
    if (!callObject) return;
    let lastState = null;
    function onQuality(ev) {
      const payload = networkQualityPayload(ev);
      if (!isNetworkStateChange(lastState, payload)) return;
      lastState = payload.state;
      reportDiagnostic(initialSession.id, 'network-quality-change', payload);
    }
    function onConnection(ev) {
      reportDiagnostic(initialSession.id, 'network-connection', {
        type: ev?.type,
        event: ev?.event,
      });
    }
    callObject.on('network-quality-change', onQuality);
    callObject.on('network-connection', onConnection);
    return () => {
      callObject.off('network-quality-change', onQuality);
      callObject.off('network-connection', onConnection);
    };
  }, [callObject, initialSession.id]);

  // an unintentional 'left-meeting' event does NOT mean the host kicked us —
  // this same Daily event also fires on a genuine connection/meeting error
  // (bad wifi, a revoked mic permission, anything else fatal to the call). it
  // used to be treated as an ejection and redirected straight to the branded
  // "the host removed you" page, which meant a real, non-kicked participant
  // could see that message purely because their connection blipped mid-round.
  // the ONLY authoritative signal for an actual kick is the server's `me.kicked`
  // flag, already checked on every 2s poll above (data.me.kicked) — that path
  // is unaffected by this change and still redirects correctly on a real kick.
  // here we instead treat it as a dropped connection and try to rejoin the
  // room we're supposed to be in, rather than assuming we were ejected.
  useEffect(() => {
    if (!callObject) return;
    const handler = () => {
      if (intentionalLeaveRef.current) return;
      // if the session just ended, the room deletion booted us — nothing to
      // reconnect to. the poll will render EndedView shortly.
      if (sessionRef.current.status === 'ended') return;
      console.warn('[daily] unexpected left-meeting · attempting reconnect');
      showToast('connection hiccup · reconnecting...', 'error');
      joinedNameRef.current = null;
      setReconnectNonce((n) => n + 1);
    };
    callObject.on('left-meeting', handler);
    return () => { callObject.off('left-meeting', handler); };
  }, [callObject]);

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
          intentionalLeaveRef.current = true;
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
        intentionalLeaveRef.current = true;
        await callObject.leave().catch(() => {});
      }
      joinedNameRef.current = null;
      if (cancelled) return;

      await callObject.join({ url, token });
      // we're back in a room · any future left-meeting that's NOT followed by a
      // matching intentional flag is a real kick.
      intentionalLeaveRef.current = false;
      if (cancelled) return;

      // explicitly enable local media after join · browsers don't reliably honor
      // videoSource/audioSource:true on the call object alone.
      try { await callObject.setLocalVideo(true); } catch (e) { console.warn('[daily] setLocalVideo failed', e); }
      try { await callObject.setLocalAudio(true); } catch (e) { console.warn('[daily] setLocalAudio failed', e); }
      // attempt daily's krisp noise cancellation; falls back to browser-native if not on plan
      try { await callObject.updateInputSettings({ audio: { processor: { type: 'noise-cancellation' } } }); } catch (e) { console.warn('[daily] noise-cancellation init failed', e); }

      joinedNameRef.current = target.name;
      setCurrentRoom({ name: target.name, isPair: target.isPair });

      // nudge iOS audio playback after each room switch · DailyAudio mounts new
      // <audio> elements per room and iOS sometimes needs them poked into play.
      // the MutationObserver above is the real fix (it catches audio elements
      // whenever they actually appear); these are just extra, cheap safety-net
      // attempts spread over a few seconds in case the observer isn't available
      // or a browser needs a repeated nudge.
      [300, 1000, 2500, 5000].forEach((delay) => setTimeout(unlockIosAudio, delay));

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
  }, [callObject, targetName, participantName, reconnectNonce]); // eslint-disable-line

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
        intentionalLeaveRef.current = true; // page is closing · ours, not a kick
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

  // waiting room: host opened the session but hasn't let me in yet
  if (admitted === false && participantName) {
    return (
      <>
        {broadcast && <BroadcastBanner text={broadcast.text} />}
        {directMessage && (
          <DirectMessageBanner
            text={directMessage.text}
            action={directMessage.action}
            onUnmute={unmuteSelf}
            onClose={dismissDirectMessage}
            onReply={() => setShowFlagComposer(true)}
          />
        )}
        <WaitingRoomView session={session} myName={participantName} onFlag={() => setShowFlagComposer(true)} />
        {showFlagComposer && (
          <FlagComposerModal
            onClose={() => setShowFlagComposer(false)}
            onSend={sendFlag}
          />
        )}
      </>
    );
  }

  // pair room
  if (callObject && currentRoom?.isPair && myAssignment) {
    return (
      <DailyProvider callObject={callObject}>
        <PairRoomView
          assignment={myAssignment}
          session={session}
          myName={participantName}
          myLinkedin={myLinkedin}
          myAvatarUrl={myAvatarUrl}
          transition={transition}
          transitionCountdown={transitionCountdown}
          onEditProfile={() => setShowEdit(true)}
          onFlag={() => setShowFlagComposer(true)}
        />
        {/* renders hidden <audio> elements for remote participants · without this,
            mics capture but nobody can hear anyone (custom call-object UI). */}
        <DailyAudio />
        {broadcast && <BroadcastBanner text={broadcast.text} />}
        {directMessage && (
          <DirectMessageBanner
            text={directMessage.text}
            action={directMessage.action}
            onUnmute={unmuteSelf}
            onClose={dismissDirectMessage}
            onReply={() => setShowFlagComposer(true)}
          />
        )}
        {showFlagComposer && (
          <FlagComposerModal
            onClose={() => setShowFlagComposer(false)}
            onSend={sendFlag}
          />
        )}
        {showEdit && (
          <EditProfileModal
            session={session}
            initialName={participantName}
            initialLinkedin={myLinkedin}
            callObject={callObject}
            onClose={(saved, data) => {
              setShowEdit(false);
              if (saved && data?.name) setParticipantName(data.name);
            }}
          />
        )}
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
          isOrphaned={isOrphaned}
          orphanedFromName={orphanedFromName}
          withHostAssignment={isWithHost ? myAssignment : null}
          withVideo
          onEditProfile={() => setShowEdit(true)}
          onFlag={() => setShowFlagComposer(true)}
        />
        {/* hidden audio elements for everyone in the main room */}
        <DailyAudio />
        {broadcast && <BroadcastBanner text={broadcast.text} />}
        {directMessage && (
          <DirectMessageBanner
            text={directMessage.text}
            action={directMessage.action}
            onUnmute={unmuteSelf}
            onClose={dismissDirectMessage}
            onReply={() => setShowFlagComposer(true)}
          />
        )}
        {showFlagComposer && (
          <FlagComposerModal
            onClose={() => setShowFlagComposer(false)}
            onSend={sendFlag}
          />
        )}
        {showEdit && (
          <EditProfileModal
            session={session}
            initialName={participantName}
            initialLinkedin={myLinkedin}
            callObject={callObject}
            onClose={(saved, data) => {
              setShowEdit(false);
              if (saved && data?.name) setParticipantName(data.name);
            }}
          />
        )}
      </DailyProvider>
    );
  }

  // fallback: static main room (joining/loading or draft)
  return (
    <>
      {broadcast && <BroadcastBanner text={broadcast.text} />}
      {directMessage && (
        <DirectMessageBanner
          text={directMessage.text}
            action={directMessage.action}
            onUnmute={unmuteSelf}
          onClose={dismissDirectMessage}
          onReply={() => setShowFlagComposer(true)}
        />
      )}
    <MainRoomView
      session={session}
      participants={participants}
      participantsByName={participantsByName}
      myName={participantName}
      myId={participantId}
      isLateJoiner={isLateJoiner}
      isWithHost={isWithHost}
      isOrphaned={isOrphaned}
      orphanedFromName={orphanedFromName}
      withHostAssignment={isWithHost ? myAssignment : null}
      withVideo={false}
    />
    {showFlagComposer && (
      <FlagComposerModal
        onClose={() => setShowFlagComposer(false)}
        onSend={sendFlag}
      />
    )}
    </>
  );
}

// ============================================================================
// MAIN ROOM VIEW · works both with and without daily video
// ============================================================================
function MainRoomView({ session, participants, participantsByName, myName, myId, isLateJoiner, isWithHost, isOrphaned, orphanedFromName, withHostAssignment, withVideo, onEditProfile, onFlag }) {
  const liveCount = participants.filter((p) => p.is_present).length;
  const isPreSession = session.status === 'live' || session.status === 'draft';
  const isClosing = session.status === 'closing';
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  // view mode (participant main room) · persisted across sessions in localStorage
  const [viewMode, setViewMode] = useState('gallery');
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('gc:viewMode');
      if (saved === 'gallery' || saved === 'speaker' || saved === 'large') setViewMode(saved);
    } catch {}
  }, []);
  function updateViewMode(m) {
    setViewMode(m);
    try { window.localStorage.setItem('gc:viewMode', m); } catch {}
  }

  // when paired with the host, count down the round timer locally
  const [hostSecondsLeft, setHostSecondsLeft] = useState(withHostAssignment?.secondsRemaining || 0);
  useEffect(() => {
    if (!isWithHost) return;
    setHostSecondsLeft(Math.max(0, withHostAssignment?.secondsRemaining || 0));
    const id = setInterval(() => setHostSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [isWithHost, withHostAssignment?.pairingId]); // eslint-disable-line

  return (
    <main className="min-h-screen flex flex-col" style={{ background: '#f4f4f1', color: '#000' }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 bg-white">
        <div>
          <div className="text-[9px] uppercase tracking-widest font-bold text-neutral-400 leading-none mb-0.5">
            We Are For Good
          </div>
          <div className="display text-xl leading-none">
            Good<span style={{ color: '#01ecf3' }}>*</span>Chats
          </div>
        </div>
        <div className="text-xs text-neutral-500">
          <span className="font-bold text-black">{liveCount}</span> here · {session.name}
        </div>
      </header>

      {isLateJoiner && (
        <div className="px-6 py-2 text-center text-[11px] uppercase tracking-widest font-bold text-black" style={{ background: '#01ecf3' }}>
          * rounds in progress · you'll be folded in at the next reshuffle *
        </div>
      )}

      {isOrphaned && (
        <div className="px-6 py-2 text-center text-[11px] uppercase tracking-widest font-bold text-black" style={{ background: '#fbbf24' }}>
          * {orphanedFromName || 'your partner'} stepped away · hang tight, the host can place you with someone else *
        </div>
      )}

      {isWithHost && (
        <div className="px-6 py-4 flex items-center justify-between gap-4 border-b-2" style={{ background: '#01ecf3', borderColor: '#00c8cf', color: '#000' }}>
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-widest font-black mb-1">✨ host time this round ✨</div>
            <div className="display text-xl font-bold">you've got the host's full attention.</div>
            {withHostAssignment?.prompt && (
              <div className="text-sm mt-1.5 font-medium opacity-80">{withHostAssignment.prompt}</div>
            )}
          </div>
          <div className="flex flex-col items-center gap-1 flex-shrink-0">
            <div className="display text-4xl font-black" style={{ color: hostSecondsLeft <= 30 ? '#92400e' : '#000' }}>
              {fmtTime(hostSecondsLeft)}
            </div>
            <div className="text-[9px] uppercase tracking-widest font-bold opacity-60">remaining</div>
          </div>
        </div>
      )}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr,360px] overflow-hidden">

        {/* gallery (video or static) */}
        <div className="p-6 overflow-y-auto flex flex-col min-h-0">
          <div className="flex items-start justify-between gap-3 mb-2">
            <div className="text-xs uppercase tracking-widest text-neutral-500 font-semibold">
              main room · everyone together
            </div>
            {withVideo && <ViewModeToggle mode={viewMode} onChange={updateViewMode} theme="light" />}
          </div>
          <div className="display text-3xl mb-6">
            {isPreSession
              ? <>welcome in.<br/>we'll start together.</>
              : isWithHost
                ? <>host time.<br/>this one's for you.</>
                : isLateJoiner
                  ? <>hang tight.<br/>next round picks you up.</>
                  : isClosing
                    ? <>all rounds done.<br/>host is wrapping up.</>
                    : <>between rounds.<br/>nice work.</>}
          </div>

          {withVideo
            ? <MainRoomVideoGallery participantsByName={participantsByName} mode={viewMode} />
            : <MainRoomStaticGallery participants={participants} myId={myId} />}
        </div>

        {/* right rail */}
        <aside className="bg-white border-l border-neutral-200 p-6 flex flex-col gap-4 overflow-hidden">
          <div className="rounded-md p-5 flex-shrink-0" style={{ background: '#01ecf3', color: '#000' }}>
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
                ? '[you\'re chatting directly with the host this round · no breakout needed 🎉]'
                : isLateJoiner
                  ? '[others are paired up in breakouts · you\'ll join the next shuffle]'
                  : isClosing
                    ? '[stick around for the host\'s wrap-up · the call closes when they hit close out]'
                    : '[the host will kick things off · you\'ll get auto-paired]'}
            </p>
          </div>

          <div className="rounded-md bg-neutral-50 border border-neutral-200 p-4 flex-shrink-0">
            <div className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2 font-semibold">about this session</div>
            <div className="text-sm text-neutral-700 space-y-2">
              <div className="flex justify-between"><span>rounds</span><span className="font-semibold text-black">{session.rounds_total}</span></div>
              <div className="flex justify-between"><span>per round</span><span className="font-semibold text-black">{Math.round(session.round_seconds / 60)} min</span></div>
              <div className="flex justify-between"><span>matching</span><span className="font-semibold text-black">random · no repeats</span></div>
            </div>
          </div>

          {withVideo && (
            <ChatPanel
              myName={myName}
              theme="light"
              title="chat · everyone in the room"
              placeholder="say hi to the room..."
              emptyHint="[say hello, drop a link, react to the prompt — everyone in the main room sees this]"
              className="flex flex-1 min-h-0 border border-neutral-200 rounded-md"
            />
          )}
        </aside>

      </div>

      {withVideo && <ParticipantControlBar sessionCode={session?.code} sessionId={session?.id} theme="light" onEditProfile={onEditProfile} onFlag={onFlag} />}

      {!withVideo && (
        <footer className="border-t border-neutral-200 bg-white px-6 py-3 flex items-center justify-between">
          <div className="text-xs text-neutral-500">main room · everyone together</div>
          <button
            onClick={() => setConfirmingLeave(true)}
            className="text-sm border border-red-500 text-red-500 px-4 py-2 rounded font-semibold hover:bg-red-500 hover:text-white"
          >
            leave
          </button>
        </footer>
      )}
      {confirmingLeave && (
        <LeaveConfirmModal
          onConfirm={() => { window.location.href = session?.code ? `/r/${session.code}` : '/'; }}
          onClose={() => setConfirmingLeave(false)}
        />
      )}
    </main>
  );
}

// on-brand replacement for a native confirm() on "leave this session" · a
// native browser dialog is jarring against this app's fully custom UI,
// especially on mobile Safari/Chrome.
function LeaveConfirmModal({ onConfirm, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-md p-6 max-w-sm w-full sticker" style={{ color: '#000' }}>
        <div className="display text-2xl mb-2">leave this session?</div>
        <p className="text-sm text-neutral-600 mb-5">you can rejoin anytime with the same link, as long as the session is still going.</p>
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="text-sm underline text-neutral-500 hover:text-black">stay</button>
          <button type="button" onClick={onConfirm} className="px-4 py-2 rounded-md border-2 border-red-500 text-red-600 hover:bg-red-500 hover:text-white font-semibold text-sm">leave</button>
        </div>
      </div>
    </div>
  );
}

// daily-aware video gallery for main room · supports three layouts driven by `mode`
function MainRoomVideoGallery({ participantsByName, mode = 'gallery' }) {
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const activeSpeakerId = useActiveSpeakerId();
  const ids = [localId, ...remoteIds].filter(Boolean);

  if (ids.length === 0) {
    return <div className="text-neutral-500 italic text-sm">[connecting to the main room...]</div>;
  }

  if (mode === 'speaker') {
    // featured = active speaker if known and present, else local, else first remote
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
function PairRoomView({ assignment, session, myName, myLinkedin, myAvatarUrl, transition, transitionCountdown, onEditProfile, onFlag }) {
  const daily = useDaily();
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const [secondsLeft, setSecondsLeft] = useState(assignment.secondsRemaining || session.round_seconds);
  const [captured, setCaptured] = useState(false);
  // the countdown itself is purely visual (color/pulse) with no programmatic
  // announcement, so a screen-reader user gets no cue the round is ending —
  // announce only at a couple of milestones, not every second, so it isn't spam.
  const [timeAnnouncement, setTimeAnnouncement] = useState('');
  const announcedRef = useRef(new Set());

  useEffect(() => {
    setSecondsLeft(Math.max(0, assignment.secondsRemaining || 0));
    announcedRef.current = new Set();
    setTimeAnnouncement('');
    const id = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [assignment]);

  useEffect(() => {
    const milestone = secondsLeft === 30 ? '30 seconds left'
      : secondsLeft === 10 ? '10 seconds left'
      : secondsLeft === 0 ? "time's up" : null;
    if (milestone && !announcedRef.current.has(milestone)) {
      announcedRef.current.add(milestone);
      setTimeAnnouncement(milestone);
    }
  }, [secondsLeft]);

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
    <main className="min-h-screen flex flex-col" style={{ background: '#f4f4f1', color: '#000' }}>
      <header className="flex items-center justify-between px-6 py-3 border-b border-neutral-200 bg-white">
        <div className="flex items-center gap-3">
          <div className="display text-sm">round <span style={{ color: '#01ecf3' }}>{session.current_round}</span>/{session.rounds_total}</div>
          {wrapUp && <span className="text-xs uppercase tracking-widest font-bold animate-pulse" style={{ color: '#d97706' }}>* wrapping up · next partner soon</span>}
        </div>
        <div className="display text-3xl" style={{ color: wrapUp ? '#d97706' : '#000' }}>
          {fmtTime(secondsLeft)}
        </div>
        <div className="text-xs text-neutral-500">{assignment.roomLabel}</div>
        <span className="sr-only" role="status" aria-live="polite">{timeAnnouncement}</span>
      </header>

      <div className="px-6 py-4 border-b border-neutral-200 flex items-center justify-between gap-4" style={{ background: 'rgba(1,236,243,0.15)' }}>
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1 text-neutral-600">this round's prompt</div>
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
          <DailyVideoTile sessionId={localId} isLocal nameOverride={myName} linkedinOverride={myLinkedin} avatarOverride={myAvatarUrl} />
          {remoteIds.length > 0 ? (
            <DailyVideoTile sessionId={remoteIds[0]} cyan nameOverride={assignment.partnerName} linkedinOverride={assignment.partnerLinkedinUrl} avatarOverride={assignment.partnerAvatarUrl} />
          ) : (
            <div className="rounded-md bg-neutral-900 border-2 border-dashed border-neutral-700 flex items-center justify-center">
              <div className="text-center">
                <div className="display text-2xl mb-2">{assignment.partnerName}</div>
                <p className="text-sm text-neutral-500">[connecting · hang tight]</p>
              </div>
            </div>
          )}
        </div>
        <ChatPanel
          myName={myName}
          theme="light"
          title="chat · just between you two"
          placeholder="message..."
          emptyHint="[share a link, drop a quick note, whatever feels useful]"
          className="hidden lg:flex border-l border-neutral-200"
        />
      </div>

      <ParticipantControlBar sessionCode={session?.code} sessionId={session?.id} theme="light" onEditProfile={onEditProfile} onFlag={onFlag} />
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
// shared video tile component used by both pair room and main room
// ============================================================================
function DailyVideoTile({ sessionId, isLocal, cyan, nameOverride, linkedinOverride, avatarOverride, participantsByName, tileClassName }) {
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

  // resolve linkedin/avatar: explicit override wins, else lookup by name in main room gallery
  const linkedinUrl = linkedinOverride || participantsByName?.[name]?.linkedin_url || null;
  const avatarUrl = avatarOverride || participantsByName?.[name]?.avatar_url || null;

  const isHostTile = name?.toLowerCase().includes('host') || (!isLocal && participantsByName?.[name]?.is_host);
  const borderStyle = (cyan || isHostTile)
    ? { border: '2px solid #01ecf3' }
    : { border: '1px solid #262626' };

  // pretty display name handling
  const displayName = isLocal
    ? `${name === 'host' || name === 'host (you)' ? 'you' : name} · you`
    : name;

  return (
    <div className={`relative rounded-md overflow-hidden bg-neutral-900 ${tileClassName || 'aspect-video'}`} style={borderStyle}>
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
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-black" />
          ) : (
          <div
            className="w-16 h-16 rounded-full display flex items-center justify-center text-black text-xl"
            style={{ background: colorForName(name || '') }}
          >
            {initials(name || '?')}
          </div>
          )}
        </div>
      )}
      <div className="absolute bottom-2 left-2 bg-black px-2.5 py-1.5 rounded-md text-sm font-bold text-white flex items-center gap-2">
        <span>{displayName}</span>
        {linkedinUrl && (
          <a
            href={linkedinUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={isLocal ? 'your linkedin (what others see)' : 'open linkedin'}
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
function ParticipantControlBar({ sessionCode, sessionId, theme = 'dark', onEditProfile, onFlag }) {
  const daily = useDaily();
  const localId = useLocalSessionId();
  const videoState = useMediaTrack(localId, 'video');
  const audioState = useMediaTrack(localId, 'audio');
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [showTroubleshoot, setShowTroubleshoot] = useState(false);
  // mic is "on" but nothing is coming through. two signals: daily reports the
  // track as interrupted (muted at the OS/hardware level, or another app took
  // it), or the local audio level has been flat for a long stretch. soft,
  // dismissible — someone quietly listening looks identical to a dead mic.
  const [micSilent, setMicSilent] = useState(false);
  const [silentDismissedAt, setSilentDismissedAt] = useState(0);

  const videoOn = videoState?.state === 'sendable' || videoState?.state === 'playable';
  const audioOn = audioState?.state === 'sendable' || audioState?.state === 'playable';
  const videoBlocked = videoState?.state === 'blocked';
  const audioBlocked = audioState?.state === 'blocked';

  async function toggleAudio() {
    unlockIosAudio(); // every tap doubles as an iOS audio unlock
    if (!daily) return;
    try { await daily.setLocalAudio(!audioOn); } catch {}
  }
  async function toggleVideo() {
    unlockIosAudio();
    if (!daily) return;
    // tapping here is a user gesture · this is what lets iOS Safari actually start the camera
    try { await daily.setLocalVideo(!videoOn); } catch (e) { console.warn('setLocalVideo failed', e); }
  }

  const micInterrupted = audioState?.state === 'interrupted';
  useEffect(() => {
    if (!daily || !audioOn) { setMicSilent(false); return undefined; }
    let cancelled = false;
    let started = false;
    let lastSound = Date.now();
    const onLevel = (ev) => { if ((ev?.audioLevel || 0) > 0.002) lastSound = Date.now(); };
    (async () => {
      try {
        await daily.startLocalAudioLevelObserver(500);
        if (cancelled) { try { daily.stopLocalAudioLevelObserver(); } catch {} return; }
        started = true;
        daily.on('local-audio-level', onLevel);
      } catch {}
    })();
    const id = setInterval(() => setMicSilent(Date.now() - lastSound > 45000), 3000);
    return () => {
      cancelled = true;
      clearInterval(id);
      try { daily.off('local-audio-level', onLevel); } catch {}
      if (started) { try { daily.stopLocalAudioLevelObserver(); } catch {} }
    };
  }, [daily, audioOn]);
  const showMicWarning = (micInterrupted || micSilent) && Date.now() - silentDismissedAt > 5 * 60 * 1000;

  // tell the server what our mic is doing, so the host can see it. the host's own
  // daily connection only covers the MAIN room, which means during a round it can't
  // see anyone's mic at all (that's why the "mic blocked" tag never appeared on a
  // paired person). this self-report is the host's only view into a round room.
  // 'loading' (a transient state while a track starts) is skipped, the report is
  // debounced so a flicker doesn't spam, and it only fires when the state changes.
  const micReportState = audioBlocked
    ? 'blocked'
    : micInterrupted
      ? 'interrupted'
      : audioOn
        ? (micSilent ? 'silent' : 'on')
        : audioState?.state === 'off'
          ? 'muted'
          : null;
  const lastMicReportRef = useRef(null);
  useEffect(() => {
    if (!sessionId || !micReportState || micReportState === lastMicReportRef.current) return undefined;
    const t = setTimeout(() => {
      lastMicReportRef.current = micReportState;
      reportDiagnostic(sessionId, 'mic-state', { state: micReportState });
    }, 1500);
    return () => clearTimeout(t);
  }, [sessionId, micReportState]);

  const light = theme === 'light';
  const footerClass = light ? 'border-neutral-200 bg-white' : 'border-neutral-800 bg-black';
  const onClass = light ? 'bg-neutral-100 border-neutral-300 text-black' : 'bg-neutral-800 border-neutral-700 text-white';
  const offClass = light ? 'bg-red-50 border-red-300 text-red-600' : 'bg-red-900/30 border-red-700 text-red-300';
  const leaveClass = light
    ? 'border-red-500 text-red-500 hover:bg-red-500 hover:text-white'
    : 'border-red-500 text-red-400 hover:bg-red-500 hover:text-white';

  return (
    <>
      {audioBlocked && <MicBlockedOverlay daily={daily} />}
      {showMicWarning && !audioBlocked && (
        <div
          className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[150] max-w-md w-[calc(100%-2rem)] rounded-md p-3 sticker"
          style={{ background: '#fff7e6', border: '2px solid #d97706', color: '#000' }}
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0 text-sm">
              <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: '#d97706' }}>* heads up *</div>
              {micInterrupted
                ? "your mic is on, but your device isn't sending any sound — it may be muted on your headset/laptop, or another app has it."
                : "we're not picking up any sound from your mic. totally fine if you're just listening — but if people can't hear you, tap below."}
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setSilentDismissedAt(Date.now()); setShowTroubleshoot(true); }}
                  className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded"
                  style={{ background: '#d97706', color: '#fff' }}
                >
                  fix my mic →
                </button>
              </div>
            </div>
            <button
              onClick={() => setSilentDismissedAt(Date.now())}
              className="text-lg leading-none text-neutral-500 hover:text-black flex-shrink-0"
              title="dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}
      <footer className={`border-t px-6 py-3 flex items-center justify-center gap-3 flex-wrap ${footerClass}`}>
        <div
          className={`inline-flex items-center rounded-full border ${audioOn ? onClass : offClass}`}
        >
          <button
            onClick={toggleAudio}
            className="px-4 py-2 text-xs font-semibold rounded-l-full"
          >
            {audioOn ? 'mic on' : (audioBlocked ? '🔇 mic blocked · fix it ↑' : 'mic off · tap to unmute')}
          </button>
          <span aria-hidden="true" className="self-stretch w-px my-1.5" style={{ background: 'currentColor', opacity: 0.25 }} />
          <DeviceMenu kind="audio" daily={daily} theme={theme} connected />
        </div>
        <div
          className={`inline-flex items-center rounded-full border ${videoOn ? onClass : offClass}`}
          style={!videoOn ? { background: '#01ecf3', color: '#000', borderColor: '#01ecf3' } : {}}
        >
          <button
            onClick={toggleVideo}
            className="px-4 py-2 text-xs font-semibold rounded-l-full"
          >
            {videoOn ? 'cam on' : (videoBlocked ? 'camera blocked · check browser settings' : 'tap to turn on camera')}
          </button>
          <span aria-hidden="true" className="self-stretch w-px my-1.5" style={{ background: 'currentColor', opacity: 0.25 }} />
          <DeviceMenu kind="video" daily={daily} theme={theme} connected />
        </div>
        {onEditProfile && (
          <button
            onClick={onEditProfile}
            className={`px-4 py-2 rounded-full text-xs font-semibold border ${onClass}`}
            title="update your name or linkedin"
          >
            edit info
          </button>
        )}
        <button
          onClick={() => setShowTroubleshoot(true)}
          className={`px-4 py-2 rounded-full text-xs font-semibold border ${onClass}`}
          title="having audio or video trouble? get help"
        >
          🔧 trouble hearing/being heard?
        </button>
        {onFlag && (
          <button
            onClick={onFlag}
            className={`px-4 py-2 rounded-full text-xs font-semibold border ${light ? 'bg-amber-50 border-amber-400 text-amber-700 hover:bg-amber-100' : 'bg-amber-900/30 border-amber-600 text-amber-300 hover:bg-amber-900/50'}`}
            title="raise a flag · the host will be notified"
          >
            🚩 need help
          </button>
        )}
        <button
          onClick={() => setConfirmingLeave(true)}
          className={`px-4 py-2 rounded-full text-xs font-semibold border ${leaveClass}`}
        >
          leave
        </button>
      </footer>
      {confirmingLeave && (
        <LeaveConfirmModal
          onConfirm={() => { window.location.href = sessionCode ? `/r/${sessionCode}` : '/'; }}
          onClose={() => setConfirmingLeave(false)}
        />
      )}
      {showTroubleshoot && (
        <TroubleshootModal
          daily={daily}
          sessionCode={sessionCode}
          onFlag={onFlag}
          onClose={() => setShowTroubleshoot(false)}
        />
      )}
    </>
  );
}

// ============================================================================
// TROUBLESHOOT MODAL · self-serve help for "can't hear / can't be heard."
// most of what causes this lives outside the app entirely — a blocked OS
// permission, another app holding the mic, a flaky driver, a firewall
// dropping the traffic — nothing here can reach into someone else's device
// or network and fix those directly. what this CAN do is turn "explain the
// fix over chat mid-event" into "click this, follow a few steps," in the
// order they're actually likely to help, ending in a real escalation path
// (flagging the host) instead of leaving someone stuck with no next move.
// ============================================================================
function TroubleshootModal({ daily, sessionCode, onFlag, onClose }) {
  const [retrying, setRetrying] = useState(false);

  async function retryMicCam() {
    if (retrying || !daily) return;
    setRetrying(true);
    try {
      try { await daily.updateInputSettings({ audio: { processor: { type: 'none' } } }); } catch {}
      await daily.setLocalAudio(true);
      await daily.setLocalVideo(true);
    } catch (e) {
      console.warn('[troubleshoot] retry failed', e);
    }
    setTimeout(() => setRetrying(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="bg-white text-black rounded-xl p-6 max-w-md w-full shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="display text-2xl">sorry you're having trouble <span style={{ color: '#01ecf3' }}>*</span></div>
          <button onClick={onClose} className="text-xl text-neutral-500 hover:text-black leading-none flex-shrink-0">×</button>
        </div>
        <p className="text-sm text-neutral-600 mb-5">
          audio/video trouble is almost always fixable in a minute. here's the stuff most likely to help, roughly in order:
        </p>

        <div className="space-y-3 mb-5">
          <div className="rounded-lg p-3" style={{ background: '#f4f4f1' }}>
            <p className="font-bold text-sm mb-1">1 · check your mic/camera permission</p>
            <p className="text-xs text-neutral-600 mb-2">click the 🔒 or ⓘ icon in your browser's address bar, set microphone + camera to allow, then try again below — no refresh needed.</p>
            <button
              onClick={retryMicCam}
              disabled={retrying}
              className="w-full py-2 rounded-md font-bold text-xs disabled:opacity-60"
              style={{ background: '#01ecf3', color: '#000' }}
            >
              {retrying ? 'checking...' : "i fixed it · try again →"}
            </button>
          </div>

          <div className="rounded-lg p-3" style={{ background: '#f4f4f1' }}>
            <p className="font-bold text-sm mb-1">2 · try a different device</p>
            <p className="text-xs text-neutral-600">use the <strong>▾</strong> next to your mic/camera buttons above to switch — especially if you've got a headset or AirPods connected that might not be selected.</p>
          </div>

          <div className="rounded-lg p-3" style={{ background: '#f4f4f1' }}>
            <p className="font-bold text-sm mb-1">3 · close anything else using your mic/camera</p>
            <p className="text-xs text-neutral-600">another video call, a different tab with this same session open, Zoom/Teams in the background — any of these can quietly hold onto your mic.</p>
          </div>

          <div className="rounded-lg p-3" style={{ background: '#f4f4f1' }}>
            <p className="font-bold text-sm mb-1">4 · leave and rejoin</p>
            <p className="text-xs text-neutral-600 mb-2">a clean reconnect fixes more than you'd expect. your info is saved — rejoining takes one click.</p>
            <button
              onClick={() => { window.location.href = sessionCode ? `/r/${sessionCode}` : '/'; }}
              className="w-full py-2 rounded-md font-bold text-xs border border-black"
            >
              leave & rejoin
            </button>
          </div>

          <div className="rounded-lg p-3" style={{ background: '#f4f4f1' }}>
            <p className="font-bold text-sm mb-1">5 · on hotel, work, or public wifi?</p>
            <p className="text-xs text-neutral-600">some networks block the kind of connection video calls need. if you've got a phone nearby, try switching to its personal hotspot.</p>
          </div>
        </div>

        <p className="text-xs text-neutral-500 mb-3">still stuck after that? we've got you — let the host know and they'll help you out directly.</p>
        <button
          onClick={() => { onClose(); onFlag?.(); }}
          className="w-full py-2.5 rounded-md font-bold text-sm border-2"
          style={{ borderColor: '#d97706', color: '#92400e', background: '#fff7e6' }}
        >
          🚩 still stuck · let the host know
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// MIC BLOCKED OVERLAY · shown as a full-screen modal when the browser has denied
// microphone access. guides the participant through fixing permissions + retrying.
// ============================================================================
function MicBlockedOverlay({ daily }) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (retrying || !daily) return;
    setRetrying(true);
    try {
      // disable noise cancellation first — Krisp can interfere on desktop
      try { await daily.updateInputSettings({ audio: { processor: { type: 'none' } } }); } catch {}
      // re-request mic access
      await daily.setLocalAudio(true);
    } catch (e) {
      console.warn('[mic retry]', e);
    }
    // keep spinner going for 2s so the state poll has time to reflect new status
    setTimeout(() => setRetrying(false), 2000);
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.88)' }}>
      <div className="bg-white text-black rounded-xl p-6 max-w-sm w-full shadow-2xl" style={{ border: '3px solid #01ecf3' }}>
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">🎤</div>
          <div className="display text-2xl mb-1">microphone blocked</div>
          <p className="text-sm text-neutral-600">
            your browser isn't letting Good Chats use your mic.
          </p>
        </div>
        <div className="rounded-lg p-4 mb-4 text-sm space-y-2.5" style={{ background: '#f4f4f1' }}>
          <p className="font-bold text-neutral-800">how to fix it:</p>
          <p>① click the <strong>🔒 lock</strong> or <strong>ⓘ info</strong> icon in your address bar</p>
          <p>② find <strong>Microphone</strong> and set it to <strong>Allow</strong></p>
          <p>③ hit the button below — no page refresh needed</p>
        </div>
        <p className="text-[11px] text-neutral-500 mb-4 text-center">
          still stuck? use the <strong>▾</strong> button next to the mic to switch devices,<br/>or try joining from your <strong>phone</strong>.
        </p>
        <button
          onClick={retry}
          disabled={retrying}
          className="w-full py-3 rounded-md font-bold text-sm disabled:opacity-60 transition"
          style={{ background: '#01ecf3', color: '#000' }}
        >
          {retrying ? 'checking...' : 'i fixed it · try again →'}
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// SPLITTING TRANSITION (unchanged)
// ============================================================================
function SplittingTransition({ partnerName, prompt, roomLabel, count, myName }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at center, #e6fcfd 0%, #f4f4f1 70%)', color: '#000' }}>
      <div className="absolute top-20 text-xs uppercase tracking-[0.3em] font-bold text-neutral-500">pairing up</div>

      <div className="text-center mb-8">
        <div className="text-xs uppercase tracking-widest text-neutral-500 mb-2 font-semibold">you're with</div>
        <div className="display text-6xl">
          {partnerName?.split(' ')[0] || partnerName} <span style={{ color: '#01ecf3' }}>*</span>
        </div>
      </div>

      <div className="flex items-center gap-8 mb-12">
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center display text-3xl text-black border-2 border-black"
          style={{ background: '#01ecf3', boxShadow: '4px 4px 0 #000' }}
        >
          {initials(myName)}
        </div>
        <div className="display text-2xl animate-pulse text-black">→ ←</div>
        <div
          className="w-24 h-24 rounded-full flex items-center justify-center display text-3xl text-black border-2 border-black"
          style={{ background: colorForName(partnerName), boxShadow: '4px 4px 0 #000' }}
        >
          {initials(partnerName || '')}
        </div>
      </div>

      <div className="text-center">
        <div className="text-xs uppercase tracking-widest text-neutral-500 font-semibold mb-2">opening room in</div>
        <div className="display text-9xl text-black">{count || '*'}</div>
        {roomLabel && <div className="text-sm text-neutral-500 mt-4">your room: <span className="font-semibold text-black">* {roomLabel} *</span></div>}
      </div>

      {prompt && (
        <div className="mt-8 max-w-md text-center px-5 py-3 rounded" style={{ background: 'rgba(1,236,243,0.18)', border: '1px solid rgba(1,236,243,0.5)' }}>
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1 text-neutral-600">this round's prompt</div>
          <div className="display text-base">{prompt}</div>
        </div>
      )}
    </main>
  );
}

// ============================================================================
// DEVICE CHECK · runs in the waiting room, BEFORE anyone is let into the call.
// the point is to surface a bad permission / missing mic / dead mic while the
// person still has time to fix it, instead of discovering it mid-conversation
// with a partner staring at them. results are also reported to the host's
// connection log, so "who's going to have trouble" is visible before round 1.
// ============================================================================
function DeviceCheckCard({ sessionId }) {
  const [mic, setMic] = useState('checking'); // checking | ready | prompt | denied | none
  const [cam, setCam] = useState('checking');
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [heard, setHeard] = useState('idle'); // idle | listening | yes | no
  const checkRef = useRef(null);
  const autoTriedRef = useRef(false);
  const reportedRef = useRef(new Set());
  const permsApiRef = useRef(true);

  function report(kind, state) {
    const key = `${kind}:${state}`;
    if (reportedRef.current.has(key)) return;
    reportedRef.current.add(key);
    reportDiagnostic(sessionId, 'track-state-change', { track: kind, state: `preflight ${state}` });
  }

  // permissions API is the source of truth for "denied" vs "just not asked yet"
  // (a dismissed prompt and a real denial both throw NotAllowedError from
  // getUserMedia, so the error alone can't tell them apart).
  useEffect(() => {
    let cancelled = false;
    const statuses = [];
    async function query(name) {
      try {
        const st = await navigator.permissions.query({ name });
        statuses.push(st);
        return st;
      } catch {
        permsApiRef.current = false;
        return null;
      }
    }
    async function check() {
      let m = 'prompt';
      let c = 'prompt';
      const ms = await query('microphone');
      const cs = await query('camera');
      if (ms) m = ms.state;
      if (cs) c = cs.state;
      let devices = null;
      try { devices = await navigator.mediaDevices.enumerateDevices(); } catch {}
      // some browsers return an empty list before permission is granted — only
      // trust "no device" when the list is non-empty but lacks that kind.
      const known = devices && devices.length > 0;
      const hasMic = !known || devices.some((d) => d.kind === 'audioinput');
      const hasCam = !known || devices.some((d) => d.kind === 'videoinput');
      if (cancelled) return;
      // when the browser can't report permission state at all (older Safari,
      // Firefox for some devices), don't let a re-check clobber the result of a
      // real getUserMedia test — only device presence is trustworthy then.
      const apply = (set, has, perm) => {
        if (!has) { set('none'); return; }
        if (perm) { set(perm.state === 'granted' ? 'ready' : perm.state); return; }
        set((prev) => (prev === 'checking' ? 'prompt' : prev));
      };
      apply(setMic, hasMic, ms);
      apply(setCam, hasCam, cs);
    }
    checkRef.current = check;
    check().then(() => {
      statuses.forEach((st) => { st.onchange = () => check(); });
    });
    return () => { cancelled = true; statuses.forEach((st) => { st.onchange = null; }); };
  }, []);

  useEffect(() => {
    if (mic === 'denied') report('audio', 'mic permission denied');
    if (mic === 'none') report('audio', 'no microphone found');
    if (cam === 'denied') report('video', 'camera permission denied');
  }, [mic, cam]); // eslint-disable-line

  async function meter(stream) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    try {
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      setHeard('listening');
      let sawSound = false;
      await new Promise((resolve) => {
        const started = Date.now();
        const id = setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i] - 128));
          const lvl = Math.min(1, peak / 40);
          setLevel(lvl);
          if (lvl > 0.1) sawSound = true;
          if (Date.now() - started > 6000 || (sawSound && Date.now() - started > 1500)) {
            clearInterval(id);
            resolve();
          }
        }, 100);
      });
      setHeard(sawSound ? 'yes' : 'no');
      if (!sawSound) report('audio', 'mic on but silent');
    } finally {
      try { ctx.close(); } catch {}
    }
  }

  async function runTest() {
    if (testing) return;
    setTesting(true);
    setHeard('idle');
    let stream = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setMic('ready');
      } catch (e) {
        if (!permsApiRef.current) setMic(e?.name === 'NotFoundError' ? 'none' : 'denied');
      }
      // camera on its own so a missing camera never masks a working mic
      try {
        const v = await navigator.mediaDevices.getUserMedia({ video: true });
        v.getTracks().forEach((t) => t.stop());
        setCam('ready');
      } catch (e) {
        if (!permsApiRef.current) setCam(e?.name === 'NotFoundError' ? 'none' : 'denied');
      }
      await checkRef.current?.(); // re-read the real permission state
      if (stream) await meter(stream);
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      setLevel(0);
      setTesting(false);
    }
  }

  // ask for permission up front, once, only when the browser says it hasn't been
  // asked yet — so a first-time joiner sees the prompt while they're waiting,
  // not the moment they're dropped into a conversation.
  useEffect(() => {
    if (autoTriedRef.current) return;
    if (mic === 'prompt' && permsApiRef.current) {
      autoTriedRef.current = true;
      runTest();
    }
  }, [mic]); // eslint-disable-line

  const chip = (label, st) => {
    const map = {
      checking: { t: 'checking...', c: '#737373', bg: '#f4f4f1' },
      ready: { t: 'ready', c: '#166534', bg: '#dcfce7' },
      prompt: { t: 'needs permission', c: '#92400e', bg: '#fef3c7' },
      denied: { t: 'blocked', c: '#991b1b', bg: '#fee2e2' },
      none: { t: 'not found', c: '#991b1b', bg: '#fee2e2' },
    }[st] || { t: st, c: '#737373', bg: '#f4f4f1' };
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">{label}</span>
        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ background: map.bg, color: map.c }}>{map.t}</span>
      </div>
    );
  };

  const blocked = mic === 'denied' || cam === 'denied';
  const allGood = mic === 'ready' && (cam === 'ready' || cam === 'none') && heard === 'yes';

  return (
    <div className="mt-8 max-w-sm mx-auto text-left rounded-lg p-4 bg-white border border-neutral-200">
      <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-3">quick check · mic &amp; camera</div>
      <div className="space-y-2 mb-3">
        {chip('microphone', mic)}
        {chip('camera', cam)}
      </div>

      {(testing || heard !== 'idle') && mic === 'ready' && (
        <div className="mb-3">
          <div className="h-2 rounded-full overflow-hidden" style={{ background: '#e5e5e5' }}>
            <div className="h-full" style={{ width: `${Math.round(level * 100)}%`, background: '#01ecf3', transition: 'width 100ms' }} />
          </div>
          <p className="text-xs text-neutral-600 mt-1.5">
            {heard === 'listening' && "say something — we're listening..."}
            {heard === 'yes' && 'we can hear you ✓'}
            {heard === 'no' && "we didn't pick up any sound. if you spoke, try the device menu once you're in, or check that no other app is using your mic."}
          </p>
        </div>
      )}

      {blocked && (
        <div className="rounded p-3 mb-3 text-xs" style={{ background: '#fff7e6', border: '1px solid #d97706' }}>
          <p className="font-bold mb-1">your browser is blocking {mic === 'denied' && cam === 'denied' ? 'your mic and camera' : mic === 'denied' ? 'your mic' : 'your camera'}.</p>
          <p>click the 🔒 or ⓘ icon in your address bar, set it to <strong>Allow</strong>, then check again. no refresh needed.</p>
        </div>
      )}
      {mic === 'none' && (
        <div className="rounded p-3 mb-3 text-xs" style={{ background: '#fff7e6', border: '1px solid #d97706' }}>
          <p className="font-bold mb-1">we can't find a microphone on this device.</p>
          <p>plug in a headset or mic, or try joining from your phone.</p>
        </div>
      )}

      {allGood ? (
        <p className="text-xs font-bold text-center" style={{ color: '#166534' }}>you're all set — you'll be let in shortly.</p>
      ) : (
        <button
          onClick={runTest}
          disabled={testing}
          className="w-full py-2.5 rounded-md font-bold text-sm disabled:opacity-60"
          style={{ background: '#01ecf3', color: '#000' }}
        >
          {testing ? 'checking...' : blocked || mic === 'prompt' ? 'check again →' : 'test my mic →'}
        </button>
      )}
    </div>
  );
}

// ============================================================================
// WAITING ROOM · shown before the host has admitted the participant
// no daily call · we keep polling state so the moment admitted_at flips, the
// participant transitions out of this view and into the main room.
// ============================================================================
function WaitingRoomView({ session, myName, onFlag }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-6 relative" style={{ background: '#f4f4f1', color: '#000' }}>
      <div className="max-w-md w-full text-center">
        <div className="text-xs uppercase tracking-widest font-bold text-neutral-500 mb-2">
          Good Chats · {session.name}
        </div>
        <div className="display text-5xl md:text-6xl mb-6">
          hang tight <span style={{ color: '#01ecf3' }}>*</span>
        </div>
        <p className="text-lg text-neutral-700 mb-2">
          the host is getting things ready.
        </p>
        <p className="text-sm text-neutral-500 mb-8">
          {myName ? `we'll call you ${myName.split(' ')[0]}.` : "we've got your info."}{' '}
          you'll be let in shortly. keep this tab open.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full" style={{ background: 'rgba(1,236,243,0.18)' }}>
          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#01ecf3' }}></span>
          <span className="text-xs uppercase tracking-widest font-bold text-neutral-700">waiting for the host</span>
        </div>
        <DeviceCheckCard sessionId={session.id} />
        {onFlag && (
          <div className="mt-8">
            <button
              onClick={onFlag}
              className="text-sm underline text-neutral-600 hover:text-black"
            >
              need to tell the host something? send a note →
            </button>
          </div>
        )}
      </div>
    </main>
  );
}

// ============================================================================
// host BROADCAST banner · gentle full-width strip at top, auto-fades after 15s
// (server only returns the broadcast while it's within that window)
// ============================================================================
function BroadcastBanner({ text }) {
  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 px-4 py-2 text-center text-sm font-semibold shadow"
      style={{ background: '#01ecf3', color: '#000' }}
    >
      <span className="text-[10px] uppercase tracking-widest font-bold mr-2 opacity-60">host *</span>
      {text}
    </div>
  );
}

// ============================================================================
// HOST DIRECT MESSAGE banner · dismissible, with optional reply button
// ============================================================================
function DirectMessageBanner({ text, onClose, onReply, action, onUnmute }) {
  return (
    <div className="fixed top-12 left-1/2 -translate-x-1/2 z-40 max-w-md w-[calc(100%-2rem)] rounded-md p-3 sticker" style={{ background: '#fff7e6', border: '2px solid #d97706', color: '#000' }}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-widest font-bold mb-1" style={{ color: '#d97706' }}>* a note from the host *</div>
          <div className="text-sm">{text}</div>
        </div>
        <button
          onClick={onClose}
          className="text-lg leading-none text-neutral-500 hover:text-black flex-shrink-0"
          title="dismiss"
        >
          ×
        </button>
      </div>
      {(onReply || (action === 'unmute' && onUnmute)) && (
        <div className="flex justify-end gap-2 mt-2 pt-2 border-t" style={{ borderColor: 'rgba(217, 119, 6, 0.3)' }}>
          {action === 'unmute' && onUnmute && (
            <button
              onClick={onUnmute}
              className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded"
              style={{ background: '#01ecf3', color: '#000' }}
            >
              🎤 unmute me
            </button>
          )}
          {onReply && (
          <button
            onClick={onReply}
            className="text-xs font-bold uppercase tracking-widest px-3 py-1 rounded"
            style={{ background: '#d97706', color: '#fff' }}
          >
            reply →
          </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// FLAG COMPOSER modal · participant types a short note for the host. used both
// for the initial "need help" tap and for replying to a host message.
// ============================================================================
function FlagComposerModal({ onClose, onSend }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    const ok = await onSend(text.trim() || null);
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-md p-5 max-w-md w-full sticker" style={{ color: '#000' }}>
        <div className="flex items-center justify-between mb-1">
          <div className="display text-xl">message the host</div>
          <button onClick={onClose} className="text-xl text-neutral-500 hover:text-black leading-none">×</button>
        </div>
        <p className="text-xs text-neutral-500 mb-3">[only the host sees this · optional text]</p>
        <form onSubmit={submit} className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="what do you need? (you can leave this blank · the host will see your flag)"
            rows={3}
            maxLength={500}
            autoFocus
            className="w-full border-2 border-black rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-wafg-cyan resize-none"
          />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5 text-sm underline text-neutral-600 hover:text-black">cancel</button>
            <button
              type="submit"
              disabled={busy}
              className="px-4 py-1.5 rounded-md text-sm font-bold disabled:opacity-50"
              style={{ background: '#d97706', color: '#fff' }}
            >
              {busy ? 'sending...' : '🚩 send flag'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// EDIT PROFILE MODAL · lets a participant update their name + linkedin mid-room
// ============================================================================
function EditProfileModal({ session, initialName, initialLinkedin, callObject, onClose }) {
  const [name, setName] = useState(initialName || '');
  const [linkedin, setLinkedin] = useState(initialLinkedin || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function save(e) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          sessionId: session.id,
          name: name.trim(),
          linkedinUrl: linkedin.trim() || null,
        }),
      });
      if (!res.ok) {
        setError(await res.text() || "couldn't save");
        setBusy(false);
        return;
      }
      // live-update the daily display name so people see the new name right away
      if (callObject) {
        try { await callObject.setUserName(name.trim()); } catch {}
      }
      try { window.sessionStorage.setItem(`pname:${session.id}`, name.trim()); } catch {}
      onClose(true, { name: name.trim(), linkedinUrl: linkedin.trim() || null });
    } catch {
      setError('connection issue · try again');
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(false); }}
    >
      <div className="bg-white rounded-md p-6 max-w-md w-full sticker" style={{ color: '#000' }}>
        <div className="display text-2xl mb-1">edit your info</div>
        <p className="text-xs text-neutral-500 mb-4">[updates this session and your saved profile]</p>
        <form onSubmit={save} className="space-y-3">
          <label className="block">
            <div className="text-sm font-semibold mb-1">name</div>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={48}
              required
              className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
            />
          </label>
          <label className="block">
            <div className="text-sm font-semibold mb-1">linkedin</div>
            <input
              type="text"
              value={linkedin}
              onChange={(e) => setLinkedin(e.target.value)}
              placeholder="linkedin.com/in/your-profile"
              maxLength={200}
              required
              className="w-full border-2 border-black rounded px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-wafg-cyan"
            />
          </label>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2 justify-end pt-2">
            <button
              type="button"
              onClick={() => onClose(false)}
              disabled={busy}
              className="px-4 py-2 text-sm font-semibold underline text-neutral-600 hover:text-black"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim() || !linkedin.trim()}
              className="btn-cyan px-5 py-2 rounded-md text-sm font-bold disabled:opacity-50"
            >
              {busy ? 'saving...' : 'save *'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ============================================================================
// ENDED VIEW · participant recap with their captures
// ============================================================================
function EndedView({ session }) {
  const [recap, setRecap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    fetch(`/api/sessions/${session.id}/recap`, { credentials: 'same-origin' })
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(`recap fetch failed: ${r.status}`)))
      .then((d) => { if (!cancelled) { setRecap(d); setLoading(false); } })
      .catch(() => { if (!cancelled) { setFailed(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [session.id, retryKey]);

  return (
    <main className="min-h-screen p-6 md:p-12" style={{ background: '#01ecf3', color: '#000' }}>
      <div className="max-w-2xl mx-auto">
        <div className="display text-5xl md:text-7xl mb-4">that's a wrap.</div>
        <p className="text-lg mb-1">good chats happened.</p>

        {loading && <p className="text-sm opacity-70 mt-6">[pulling your recap...]</p>}

        {!loading && failed && (
          <div className="bg-white rounded-md p-5 sticker mt-8" style={{ color: '#000' }}>
            <div className="font-semibold">couldn't load your recap right now.</div>
            <p className="text-sm text-neutral-600 mt-1">
              no worries — a recap email is still on its way to you with your captures and their linkedin links.
            </p>
            <button
              type="button"
              onClick={() => setRetryKey((k) => k + 1)}
              className="mt-3 text-sm underline text-neutral-700 hover:text-black"
            >
              try again →
            </button>
          </div>
        )}

        {!loading && !failed && recap && (
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
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-neutral-500 mt-4">
                  [a recap email is on its way to you · names + linkedin links included]
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
        <div className="mt-8 flex items-center gap-4 text-sm">
          <a href="/profile" className="underline font-semibold">your profile · see your history →</a>
          <a href="/" className="underline">close out</a>
        </div>
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
