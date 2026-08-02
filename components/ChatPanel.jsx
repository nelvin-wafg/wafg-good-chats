'use client';
import { useEffect, useRef, useState } from 'react';
import { useDaily } from '@daily-co/daily-react';

// shared live chat panel · works in any daily room (main room or a pair room).
// messages ride on daily app-messages broadcast to everyone in the SAME daily
// room, so the main-room chat and each pair-room chat are naturally scoped to
// that room's participants. messages, reactions, and replies are all ephemeral
// (kept in local state only, nothing persisted server-side).
//
// message ids are minted once by the sender and carried in the broadcast
// payload, so every client (including the sender) agrees on the same id for
// a given message — that shared id is what reactions/replies target.
//
// caller supplies the display class (flex / hidden lg:flex / etc) so this can be
// a full-height side column in pair rooms or a fixed-height card in a rail.
// theme: 'dark' (default, for the dark pair rooms / host console) or 'light'
// (for the light main room that matches the host dashboard).
const QUICK_EMOJI = ['👍', '❤️', '😂', '😮', '👏', '🎉'];

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
  const [replyTo, setReplyTo] = useState(null); // { id, text, from } | null
  const [pickerFor, setPickerFor] = useState(null); // message id currently showing the emoji picker
  const scrollRef = useRef(null);

  const light = theme === 'light';

  function applyReaction(list, targetId, emoji, from, action) {
    return list.map((m) => {
      if (m.id !== targetId) return m;
      const current = m.reactions?.[emoji] || [];
      const next = action === 'add'
        ? (current.includes(from) ? current : [...current, from])
        : current.filter((n) => n !== from);
      return { ...m, reactions: { ...m.reactions, [emoji]: next } };
    });
  }

  useEffect(() => {
    if (!daily) return;
    const handler = (event) => {
      const data = event?.data;
      if (!data) return;
      if (data.type === 'reaction') {
        if (!data.targetId || !data.emoji || !data.from || !data.action) return;
        setMessages((m) => applyReaction(m, data.targetId, data.emoji, data.from, data.action));
        return;
      }
      const text = data.text;
      if (typeof text !== 'string' || !text.trim()) return;
      setMessages((m) => [...m, {
        id: data.id || `${Date.now()}-${Math.random()}`,
        text: text.slice(0, 500),
        from: data.fromName || 'guest',
        isLocal: false,
        replyTo: data.replyTo || null,
        reactions: {},
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
    const id = `${Date.now()}-${Math.random()}`;
    const replySnapshot = replyTo ? { id: replyTo.id, text: replyTo.text, from: replyTo.from } : null;
    daily.sendAppMessage({ id, text, fromName: myName, replyTo: replySnapshot }, '*');
    setMessages((m) => [...m, {
      id,
      text,
      from: myName,
      isLocal: true,
      replyTo: replySnapshot,
      reactions: {},
    }]);
    setInput('');
    setReplyTo(null);
  }

  function toggleReaction(messageId, emoji) {
    if (!daily) return;
    const target = messages.find((m) => m.id === messageId);
    const alreadyReacted = Boolean(target?.reactions?.[emoji]?.includes(myName));
    const action = alreadyReacted ? 'remove' : 'add';
    daily.sendAppMessage({ type: 'reaction', targetId: messageId, emoji, from: myName, action }, '*');
    setMessages((m) => applyReaction(m, messageId, emoji, myName, action));
    setPickerFor(null);
  }

  const bgClass = light ? 'bg-white' : 'bg-neutral-950';
  const borderClass = light ? 'border-neutral-200' : 'border-neutral-800';
  const remoteBubble = light ? 'bg-neutral-200 text-black' : 'bg-neutral-800 text-white';
  const inputClass = light
    ? 'bg-neutral-100 text-black border-neutral-300 focus:border-cyan-500'
    : 'bg-neutral-800 text-white border-neutral-700 focus:border-cyan-400';
  const hintClass = light ? 'text-neutral-400' : 'text-neutral-600';
  const mutedLinkClass = light ? 'text-neutral-400 hover:text-neutral-700' : 'text-neutral-600 hover:text-neutral-300';
  const quoteClass = light ? 'border-neutral-300 text-neutral-500' : 'border-neutral-700 text-neutral-400';
  const pickerClass = light
    ? 'bg-white border-neutral-200 shadow-lg'
    : 'bg-neutral-900 border-neutral-700 shadow-lg';

  return (
    <div className={`flex-col overflow-hidden ${bgClass} ${className}`}>
      <div className={`px-3 py-2 border-b ${borderClass} text-[10px] uppercase tracking-widest font-bold text-neutral-500 flex-shrink-0`}>
        {title}
      </div>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5">
        {messages.length === 0 && emptyHint && (
          <p className={`text-xs italic ${hintClass}`}>{emptyHint}</p>
        )}
        {messages.map((m) => {
          const reactionEntries = Object.entries(m.reactions || {}).filter(([, names]) => names.length > 0);
          return (
          <div key={m.id} className={m.isLocal ? 'text-right' : ''}>
            {!m.isLocal && (
              <div className="text-[10px] text-neutral-500 mb-0.5">{m.from?.split(' ')[0]}</div>
            )}
            {m.replyTo && (
              <div className={`inline-block max-w-[85%] border-l-2 pl-2 mb-1 text-[11px] italic truncate ${quoteClass}`}>
                ↩ {m.replyTo.from?.split(' ')[0]}: {m.replyTo.text}
              </div>
            )}
            <div>
              <div
                className={`inline-block px-3 py-2 rounded-md max-w-[85%] text-sm break-words text-left ${m.isLocal ? '' : remoteBubble}`}
                style={m.isLocal ? { background: '#01ecf3', color: '#000' } : {}}
              >
                {m.text}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-1" style={m.isLocal ? { justifyContent: 'flex-end' } : {}}>
              {reactionEntries.map(([emoji, names]) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => toggleReaction(m.id, emoji)}
                  className={`text-[11px] leading-none rounded-full px-1.5 py-0.5 border ${names.includes(myName) ? 'border-cyan-500' : (light ? 'border-neutral-300' : 'border-neutral-700')} ${light ? 'bg-neutral-50' : 'bg-neutral-900'}`}
                  title={names.join(', ')}
                >
                  {emoji} {names.length}
                </button>
              ))}
              <div className="relative inline-block">
                <button
                  type="button"
                  onClick={() => setPickerFor((cur) => (cur === m.id ? null : m.id))}
                  className={`text-[11px] leading-none ${mutedLinkClass}`}
                  title="react"
                >
                  react +
                </button>
                {pickerFor === m.id && (
                  <>
                    <button type="button" onClick={() => setPickerFor(null)} className="fixed inset-0 z-40 cursor-default" aria-label="close reaction picker" />
                    <div className={`absolute z-50 bottom-full mb-1 ${m.isLocal ? 'right-0' : 'left-0'} rounded-md border p-1 flex gap-0.5 ${pickerClass}`}>
                      {QUICK_EMOJI.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => toggleReaction(m.id, emoji)}
                          className="w-6 h-6 rounded hover:bg-black/10 text-sm flex items-center justify-center"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => setReplyTo({ id: m.id, text: m.text, from: m.from })}
                className={`text-[11px] leading-none ${mutedLinkClass}`}
              >
                reply
              </button>
            </div>
          </div>
          );
        })}
      </div>
      {replyTo && (
        <div className={`px-3 py-1.5 border-t ${borderClass} flex items-center justify-between gap-2 text-[11px] flex-shrink-0 ${hintClass}`}>
          <span className="truncate italic">↩ replying to {replyTo.from?.split(' ')[0]}: {replyTo.text}</span>
          <button type="button" onClick={() => setReplyTo(null)} className="flex-shrink-0 font-bold">×</button>
        </div>
      )}
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
