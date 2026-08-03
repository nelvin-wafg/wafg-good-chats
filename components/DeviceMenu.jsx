'use client';
import { useEffect, useState } from 'react';

// small arrow-pill that opens a dropdown of available microphones or cameras.
// designed to sit next to a mic/cam toggle button in a video-call control bar.
// click the arrow → menu of devices → pick one → daily switches inputs live.
//
// kind: 'audio' | 'video'
// daily: the daily.js call object (callObject from useDaily or held in state)
// theme: 'dark' (default) for dark control bars, 'light' for the lit-up main room
// connected: true when rendered fused to a toggle button as one pill (the
// wrapper supplies the shared border/background/rounding; this trigger then
// just needs a transparent hover state and inherits the wrapper's text color)
export default function DeviceMenu({ kind, daily, theme = 'dark', connected = false }) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState([]);
  const [currentId, setCurrentId] = useState(null);

  useEffect(() => {
    if (!open || !daily) return;
    let cancelled = false;
    async function load() {
      try {
        const enumeration = await daily.enumerateDevices();
        const all = enumeration?.devices || [];
        const wantKind = kind === 'audio' ? 'audioinput' : 'videoinput';
        const filtered = all.filter((d) => d.kind === wantKind);
        if (cancelled) return;
        setDevices(filtered);
        if (typeof daily.getInputDevices === 'function') {
          const current = await daily.getInputDevices();
          const cur = kind === 'audio' ? current?.mic?.deviceId : current?.camera?.deviceId;
          setCurrentId(cur || null);
        }
      } catch (e) {
        console.warn('[devices] enumerate failed', e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [open, daily, kind]);

  async function pick(deviceId) {
    if (!daily) return;
    try {
      const arg = kind === 'audio'
        ? { audioDeviceId: deviceId }
        : { videoDeviceId: deviceId };
      await daily.setInputDevicesAsync(arg);
      setCurrentId(deviceId);
    } catch (e) {
      console.warn('[devices] switch failed', e);
    }
    setOpen(false);
  }

  const light = theme === 'light';
  const arrowClass = connected
    ? (light ? 'bg-transparent hover:bg-black/5' : 'bg-transparent hover:bg-white/10')
    : (light
        ? 'rounded-full border bg-neutral-100 border-neutral-300 text-black hover:bg-neutral-200'
        : 'rounded-full border bg-neutral-800 border-neutral-700 text-white hover:bg-neutral-700');
  const menuClass = light
    ? 'bg-white border border-neutral-200 text-black shadow-lg'
    : 'bg-neutral-900 border border-neutral-700 text-white shadow-lg';
  const hoverItem = light ? 'hover:bg-neutral-100' : 'hover:bg-neutral-800';
  const labelKind = kind === 'audio' ? 'microphone' : 'camera';

  return (
    <div className={connected ? 'relative flex' : 'relative'}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`px-2.5 py-2 text-xs font-semibold ${connected ? 'rounded-r-full' : ''} ${arrowClass}`}
        title={`choose ${labelKind}`}
        aria-label={`choose ${labelKind}`}
      >
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <>
          {/* backdrop · catches outside clicks to close the menu */}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
            aria-label="close menu"
          />
          <div className={`absolute bottom-full mb-2 right-0 z-50 rounded-md p-1 min-w-[220px] max-w-[320px] ${menuClass}`}>
            <div className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 opacity-60">
              {labelKind}
            </div>
            {devices.length === 0 && (
              <div className="px-2 py-2 text-xs italic opacity-60">[no devices found]</div>
            )}
            {devices.map((d) => (
              <button
                key={d.deviceId}
                type="button"
                onClick={() => pick(d.deviceId)}
                className={`w-full text-left px-2 py-2 text-sm rounded ${d.deviceId === currentId ? 'font-bold' : ''} ${hoverItem}`}
              >
                {d.deviceId === currentId && <span style={{ color: '#01ecf3' }}>✓ </span>}
                {d.label || `${labelKind} ${d.deviceId.slice(-4)}`}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
