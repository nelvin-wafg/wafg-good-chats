'use client';

// small 3-button pill that switches between video tile layouts.
// theme 'dark' for the host console, 'light' for the participant main room.
export default function ViewModeToggle({ mode, onChange, theme = 'dark' }) {
  const light = theme === 'light';
  const containerClass = light
    ? 'border border-neutral-300 bg-white'
    : 'border border-neutral-700 bg-neutral-900';
  const activeClass = light ? 'bg-black text-white' : 'bg-white text-black';
  const inactiveClass = light
    ? 'text-neutral-500 hover:text-black'
    : 'text-neutral-500 hover:text-white';

  const modes = [
    { id: 'gallery', label: 'gallery' },
    { id: 'speaker', label: 'speaker' },
    { id: 'large', label: 'large' },
  ];

  return (
    <div className={`inline-flex items-center gap-0.5 text-[10px] uppercase tracking-widest font-bold rounded-md p-0.5 ${containerClass}`}>
      {modes.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onChange(m.id)}
          className={`px-2.5 py-1 rounded ${mode === m.id ? activeClass : inactiveClass}`}
          title={`${m.label} view`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
