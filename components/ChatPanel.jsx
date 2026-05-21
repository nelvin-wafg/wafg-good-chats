'use client';
import { useEffect, useRef, useState } from 'react';
import { useDaily } from '@daily-co/daily-react';

// shared live chat panel · works in any daily room (main room or a pair room).
// messages ride on daily app-messages broadcast to everyone in the SAME daily
// room, so the main-room chat and each pair-room chat are naturally scoped to
// that room's participants. messages are ephemeral (kept in local state only).
//
// caller supplies the display class (flex / hidden lg:flex / etc) so this can be
// a full-height side column in pair rooms or a fixed-height card in a rail.
// theme: 'dark' (default, for the dark pair rooms / host console) or 'light'
// (for the light main room that matches the host dashboard).
export default function ChatPanel({
  myName,
  title = 'chat',
  placeholder = 'message...',
  emptyHint,
  className = '',
  theme = 'dark',
}) {
  const daily = useDaily();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef(null);

  const light = theme === 'light';

  useEffect(() => {
    if (!daily) return;
    const handler = (event) => {
      const text = event?.data?.text;
      if (typeof text !== 'string' || !text.trim()) return;
      setMessages((m) => [...m, {
        id: `${Date.now()}-${Math.random()}`,
        text: text.slice(0, 500),
        from: event?.data?.fromName || 'guest',
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

  const bgClass = light ? 'bg-white' : 'bg-neutral-950';
  const borderClass = light ? 'border-neutral-200' : 'border-neutral-800';
  const remoteBubble = light ? 'bg-neutral-200 text-black' : 'bg-neutral-800 text-white';
  const inputClass = light
    ? 'bg-neutral-100 text-black border-neutral-300 focus:border-cyan-500'
    : 'bg-neutral-800 text-white border-neutral-700 focus:border-cyan-400';
  const hintClass = light ? 'text-neutral-400' : 'text-neutral-600';

  return (
    <div className={`flex-col overflow-hidden ${bgClass} ${className}`}>
      <div className={`px-3 py-2 border-b ${borderClass} text-[10px] uppercase tracking-widest font-bold text-neutral-500 flex-shrink-0`}>
        {title}
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
        {messages.length === 0 && emptyHint && (
          <p className={`text-xs italic ${hintClass}`}>{emptyHint}</p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={m.isLocal ? 'text-right' : ''}>
            {!m.isLocal && (
              <div className="text-[10px] text-neutral-500 mb-0.5">{m.from?.split(' ')[0]}</div>
            )}
            <div
              className={`inline-block px-3 py-2 rounded-md max-w-[85%] text-sm break-words text-left ${m.isLocal ? '' : remoteBubble}`}
              style={m.isLocal ? { background: '#01ecf3', color: '#000' } : {}}
            >
              {m.text}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className={`p-3 border-t ${borderClass} flex gap-2 flex-shrink-0`}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          maxLength={500}
          className={`flex-1 rounded px-3 py-2 text-base border focus:outline-none ${inputClass}`}
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
