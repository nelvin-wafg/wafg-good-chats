'use client';
import { colorForName, initials } from '@/lib/brand';

// small participant tile used in galleries (main room, late-joiner side panel).
// when a real Daily.co video stream is wired up, render <DailyVideo /> in place of the avatar.
export default function ParticipantTile({ name = '', isMuted = false, size = 'md', isHost = false }) {
  const sizes = {
    sm: { tile: 'aspect-[4/3]', face: 'w-9 h-9 text-sm', name: 'text-[11px]' },
    md: { tile: 'aspect-[4/3]', face: 'w-12 h-12 text-base', name: 'text-xs' },
    lg: { tile: 'aspect-video', face: 'w-24 h-24 text-3xl', name: 'text-sm' },
  };
  const s = sizes[size] || sizes.md;

  return (
    <div className={`relative ${s.tile} bg-neutral-900 border border-neutral-800 rounded-md overflow-hidden`}>
      <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-neutral-900 to-neutral-800">
        <div
          className={`${s.face} display rounded-full flex items-center justify-center text-black`}
          style={{ background: colorForName(name) }}
        >
          {initials(name)}
        </div>
      </div>
      <div className={`${s.name} absolute bottom-1.5 left-1.5 bg-black/70 text-white px-1.5 py-0.5 rounded font-medium`}>
        {name}
      </div>
      {isHost && (
        <div className="absolute top-1.5 left-1.5 bg-wafg-cyan text-black text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded">
          Host
        </div>
      )}
      {isMuted && (
        <div className="absolute top-1.5 right-1.5 w-5 h-5 bg-red-500/30 text-red-400 text-[10px] rounded-full flex items-center justify-center">
          M
        </div>
      )}
    </div>
  );
}
