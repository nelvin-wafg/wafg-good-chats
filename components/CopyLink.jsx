'use client';
import { useState } from 'react';

// reusable share-link UI · displays the participant join URL with a copy button.
// variant: 'light' (default, on light backgrounds) | 'dark' (for dark surfaces) | 'oncyan' (for cyan backgrounds)
export default function CopyLink({ code, variant = 'light', label = 'share this link' }) {
  const [copied, setCopied] = useState(false);
  const url = typeof window !== 'undefined'
    ? `${window.location.origin}/r/${code}`
    : `/r/${code}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback for browsers/contexts without clipboard API
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
      document.body.removeChild(ta);
    }
  }

  // styles per variant
  const styles = {
    light: {
      container: 'bg-neutral-100 border border-neutral-300',
      label: 'text-neutral-500',
      url: 'text-neutral-800',
      btn: 'bg-black text-wafg-cyan border-2 border-black',
    },
    dark: {
      container: 'bg-neutral-900 border border-neutral-800',
      label: 'text-neutral-500',
      url: 'text-neutral-200',
      btn: 'bg-wafg-cyan text-black border-2 border-black',
    },
    oncyan: {
      container: 'bg-black/10 border border-black/20',
      label: 'opacity-60',
      url: '',
      btn: 'bg-black text-wafg-cyan border-2 border-black',
    },
  };
  const s = styles[variant] || styles.light;

  return (
    <div className={`rounded p-3 ${s.container}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-[10px] uppercase tracking-widest font-bold mb-1 ${s.label}`}>{label}</div>
          <div className={`font-mono text-sm truncate ${s.url}`}>{url}</div>
        </div>
        <button
          onClick={copy}
          className={`flex-shrink-0 px-3 py-2 rounded font-semibold text-xs ${s.btn}`}
          style={{ minWidth: 80 }}
        >
          {copied ? '✓ copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}
