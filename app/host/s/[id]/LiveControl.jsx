'use client';
import { useEffect, useRef, useState } from 'react';
import { DailyProvider, useDaily, useParticipantIds, useLocalSessionId } from '@daily-co/daily-react';
import DailyIframe from '@daily-co/daily-js';
import { colorForName, initials } from '@/lib/brand';
import CopyLink from '@/components/CopyLink';

// host's command center · runs the session AND shows up on camera in the main room.
// host stays in the main daily.co room for the entire active session
// (does NOT hop into pair rooms during rounds · participants do that on their own).

export default function LiveControl({ session: initialSession }) {
  const [session, setSession] = useState(initialSession);
  const [participants, setParticipants] = useState([]);
  const [pairings, setPairings] = useState([]);
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

      const co = DailyIframe.createCallObject({ videoSource: true, audioSource: true });
      await co.join({ url, token });
      if (!mounted) { co.destroy(); return; }
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

  async function action(path, body) {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${session.id}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) alert(await res.text());
    } catch (e) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }

  // build a name→profile lookup so video tiles can resolve linkedin
  const participantsByName = participants.reduce((acc, p) => {
    if (p.name) acc[p.name] = p;
    return acc;
  }, {});

  const inner = (
    <LiveControlInner
      session={session}
      participants={participants}
      participantsByName={participantsByName}
      pairings={pairings}
      secondsLeft={secondsLeft}
      busy={busy}
      action={action}
      hasCall={Boolean(callObject)}
    />
  );

  if (callObject) {
    return <DailyProvider callObject={callObject}>{inner}</DailyProvider>;
  }
  return inner;
}

// ============================================================================
// inner component (uses daily hooks if wrapped in DailyProvider)
// ============================================================================
function LiveControlInner({ session, participants, participantsByName, pairings, secondsLeft, busy, action, hasCall }) {
  const isPre = session.status === 'draft' || session.status === 'live';
  const isRunning = session.status === 'running_round';
  const isBetween = session.status === 'between_rounds';
  const isEnded = session.status === 'ended';

  const promptIdx = (session.current_round || 1) - 1;
  const currentPrompt = session.prompts?.[promptIdx]?.text;
  const nextPrompt = session.prompts?.[(session.current_round || 0)]?.text;

  return (
    <main className="min-h-screen flex flex-col text-white" style={{ background: '#0a0a0a' }}>
      <header className="border-b border-neutral-800 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/host" className="text-xs text-neutral-500 hover:text-white">← dashboard</a>
          <span className="text-neutral-600">·</span>
          <span className="text-sm font-semibold">{session.name}</span>
          <HeaderCopyLink code={session.code} />
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
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="display text-2xl">round {session.current_round} wrapped.</div>
                  {nextPrompt && <p className="text-sm text-neutral-400 mt-1">next: <span style={{ color: '#01ecf3' }}>{nextPrompt}</span></p>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => action('round', { action: 'start' })} disabled={busy} className="btn-cyan px-6 py-3 rounded-md text-lg whitespace-nowrap">
                    start round {session.current_round + 1} *
                  </button>
                  <button onClick={() => { if (confirm('end this session now? skips remaining rounds.')) action('end'); }} disabled={busy} className="px-4 py-3 rounded-md border-2 border-red-500 text-red-400 hover:bg-red-500 hover:text-white font-semibold text-sm whitespace-nowrap">
                    end session
                  </button>
                </div>
              </div>
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
                  <p className="text-sm text-neutral-400 mt-1">say a final thing · close out when ready</p>
                </div>
                <button
                  onClick={() => { if (confirm('close out the session and end the call for everyone?')) action('end'); }}
                  disabled={busy}
                  className="btn-cyan px-6 py-3 rounded-md text-lg whitespace-nowrap"
                >
                  close out *
                </button>
              </div>
            )}

            {isEnded && (
              <div>
                <div className="display text-2xl mb-1">that's a wrap.</div>
                <p className="text-sm text-neutral-400">{participants.length} people · {pairings.length} pairings.</p>
                <a href="/host" className="inline-block mt-3 text-sm underline">back to dashboard →</a>
              </div>
            )}
          </div>

          {/* video gallery · everyone in the main daily room */}
          <div className="flex-1 overflow-y-auto p-4">
            {hasCall ? <HostVideoGallery participantsByName={participantsByName} /> : (
              <div className="h-full flex items-center justify-center text-neutral-600 text-sm">
                {isEnded ? '[session has ended]' : '[main room not live yet · click "go live" to open it]'}
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
                <div key={p.id} className="text-center">
                  <div className="w-12 h-12 mx-auto rounded-full display flex items-center justify-center text-black text-base" style={{ background: colorForName(p.name) }}>
                    {initials(p.name)}
                  </div>
                  <div className="text-[10px] mt-1 text-neutral-400 truncate">{p.name?.split(' ')[0]}</div>
                </div>
              ))}
              {participants.filter((p) => p.is_present && !p.current_room_name).length === 0 && (
                <div className="col-span-4 text-xs text-neutral-600 italic">[no one here yet]</div>
              )}
            </div>
          </div>

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
                          <span className="text-neutral-500">×</span>
                          <span className={`font-medium truncate ${isWithHost ? '' : ''}`} style={isWithHost ? { color: '#01ecf3' } : {}}>
                            {isWithHost ? 'you (host)' : pa.participant_b_name}
                          </span>
                        </div>
                        <span className="text-[10px] whitespace-nowrap" style={{ color: '#01ecf3' }}>* {pa.room_label}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
// ============================================================================
function HostVideoGallery({ participantsByName }) {
  const localId = useLocalSessionId();
  const remoteIds = useParticipantIds({ filter: 'remote' });
  const ids = [localId, ...remoteIds].filter(Boolean);

  if (ids.length === 0) {
    return <div className="h-full flex items-center justify-center text-neutral-600 text-sm">[joining main room...]</div>;
  }

  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}>
      {ids.map((id) => (
        <DailyVideoTile key={id} sessionId={id} isLocal={id === localId} participantsByName={participantsByName} />
      ))}
    </div>
  );
}

function DailyVideoTile({ sessionId, isLocal, participantsByName }) {
  const ref = useRef();
  const daily = useDaily();
  const [name, setName] = useState(isLocal ? 'host (you)' : '');
  const [hasVideo, setHasVideo] = useState(false);

  useEffect(() => {
    if (!daily || !ref.current) return;
    const update = () => {
      const p = daily.participants()[sessionId];
      if (!p) return;
      const userName = p.user_name || (isLocal ? 'host (you)' : 'guest');
      setName(isLocal && p.user_name === 'host' ? 'host (you)' : userName);
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
  }, [daily, sessionId, isLocal]);

  const isHostTile = isLocal || name?.toLowerCase().startsWith('host');
  const linkedinUrl = !isHostTile ? participantsByName?.[name]?.linkedin_url : null;

  return (
    <div
      className="relative rounded-md overflow-hidden bg-neutral-900 aspect-video"
      style={isHostTile ? { border: '2px solid #01ecf3' } : { border: '1px solid #333' }}
    >
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
      <div className="absolute bottom-2 left-2 bg-black/70 backdrop-blur px-2 py-0.5 rounded text-xs font-medium flex items-center gap-2">
        <span>{name}</span>
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
      <CtrlBtn on={audioOn} onClick={toggleAudio} label={audioOn ? 'mic on' : 'mic off'} />
      <CtrlBtn on={videoOn} onClick={toggleVideo} label={videoOn ? 'cam on' : 'cam off'} />
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
