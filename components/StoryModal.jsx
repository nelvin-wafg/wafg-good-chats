'use client';
import { useEffect, useRef } from 'react';
import { STORY } from '@/lib/story';

// Horizontally-scrolling version-history showcase. Renders one card per
// version with a visual progression through the WAFG palette · earlier versions
// read sketchy/early, the current one is highlighted with a cyan ring and a
// "you are here" badge. Designed to feel like flipping through chapters.
export default function StoryModal({ onClose }) {
  const scrollerRef = useRef(null);
  const currentCardRef = useRef(null);

  // close on Esc, focus the current version on open so it lands in view
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    // scroll the current card into view (the modal opens with v0 on the left
    // by default; this nudges to the present so the visitor sees "you are here")
    const t = setTimeout(() => {
      if (currentCardRef.current && scrollerRef.current) {
        currentCardRef.current.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' });
        // then bounce back to v0 so they see the full arc
        setTimeout(() => {
          scrollerRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
        }, 800);
      }
    }, 300);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label="The story so far"
    >
      <div className="bg-white rounded-md w-full max-w-6xl max-h-[90vh] flex flex-col sticker" style={{ color: '#000' }}>

        {/* header */}
        <div className="flex items-center justify-between p-5 border-b border-neutral-200 flex-shrink-0">
          <div>
            <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500">The evolution</div>
            <div className="display text-3xl">The story so far <span style={{ color: '#01ecf3' }}>*</span></div>
          </div>
          <button
            onClick={onClose}
            className="text-2xl text-neutral-500 hover:text-black leading-none px-2"
            title="close"
          >
            ×
          </button>
        </div>

        {/* horizontal scrolling timeline */}
        <div
          ref={scrollerRef}
          className="flex-1 overflow-x-auto overflow-y-hidden p-6 snap-x snap-mandatory"
          style={{ background: '#f4f4f1' }}
        >
          <div className="flex gap-5 h-full" style={{ minWidth: 'fit-content' }}>
            {STORY.map((v, i) => (
              <div
                key={v.id}
                ref={v.current ? currentCardRef : null}
                className="snap-start flex-shrink-0 w-[340px] md:w-[380px] flex flex-col"
              >
                <StoryCard version={v} isLast={i === STORY.length - 1} />
              </div>
            ))}
          </div>
        </div>

        {/* footer hint · subtle scroll instruction */}
        <div className="px-5 py-3 border-t border-neutral-200 text-center text-xs text-neutral-500 flex-shrink-0">
          [scroll left and right to flip through the chapters]
        </div>
      </div>
    </div>
  );
}

// Individual version card. Visual treatment progresses across the row:
//   sketch  → off-white with dashed border (early, conceptual)
//   built   → plain white with solid border (it works)
//   refined → white with subtle cyan accent (it's becoming itself)
//   current → cyan ring + cyan accents + "you are here" badge
function StoryCard({ version, isLast }) {
  const { accent, current } = version;

  let containerClass = 'rounded-md p-5 md:p-6 flex flex-col flex-1 overflow-y-auto';
  let containerStyle = { background: '#fff' };
  let labelColor = '#000';

  if (accent === 'sketch') {
    containerClass += ' border-2 border-dashed border-neutral-400';
    containerStyle = { background: '#fafaf7' };
  } else if (accent === 'built') {
    containerClass += ' border-2 border-neutral-300';
  } else if (accent === 'refined') {
    containerClass += ' border-2 border-neutral-300';
    containerStyle = { background: '#fff', borderColor: 'rgba(1,236,243,0.4)' };
    labelColor = '#01ecf3';
  } else if (accent === 'current') {
    containerClass += ' border-2';
    containerStyle = { background: '#fff', borderColor: '#01ecf3', boxShadow: '4px 4px 0 #01ecf3' };
    labelColor = '#01ecf3';
  }

  return (
    <div className={containerClass} style={containerStyle}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="display text-5xl" style={{ color: labelColor }}>{version.label}</div>
        {current && (
          <span
            className="text-[10px] uppercase tracking-widest font-bold px-2 py-1 rounded"
            style={{ background: '#01ecf3', color: '#000' }}
          >
            you are here
          </span>
        )}
      </div>
      <div className="display text-2xl mb-1">{version.era}</div>
      <div className="text-xs text-neutral-500 mb-4 font-semibold">{version.dateRange}</div>
      <p className="text-sm text-neutral-700 mb-4 leading-relaxed">{version.summary}</p>

      <div className="text-[10px] uppercase tracking-widest font-bold text-neutral-500 mb-2">What landed</div>
      <ul className="space-y-1.5 text-sm text-neutral-700">
        {version.features.map((f, i) => (
          <li key={i} className="flex gap-2">
            <span className="flex-shrink-0 font-bold" style={{ color: '#01ecf3' }}>*</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {!isLast && (
        <div className="mt-auto pt-4 text-right text-[10px] uppercase tracking-widest font-bold text-neutral-400">
          and then →
        </div>
      )}
    </div>
  );
}
