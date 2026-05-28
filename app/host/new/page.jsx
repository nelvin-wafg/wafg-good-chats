'use client';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { showToast } from '@/components/Toast';

const PROMPT_LIBRARY = [
  { tag: 'opener', text: 'what brought you to the for-good world?' },
  { tag: 'opener', text: 'what are you working on that you actually love?' },
  { tag: 'opener', text: 'what made you fall for this work in the first place?' },
  { tag: 'opener', text: "what's a story you tell over and over about why you do this?" },
  { tag: 'deep', text: "what's a recent thing you changed your mind about?" },
  { tag: 'deep', text: "what are you doing next that scares you a little?" },
  { tag: 'deep', text: "what's an old assumption about our sector you've outgrown?" },
  { tag: 'deep', text: 'what does success look like to you now, versus five years ago?' },
  { tag: 'vulnerable', text: "what's been hard lately, professionally or otherwise?" },
  { tag: 'vulnerable', text: 'what part of this job do you find lonely?' },
  { tag: 'vulnerable', text: "what's a moment in this work that humbled you?" },
  { tag: 'story', text: 'tell me about a time someone in our sector showed up for you.' },
  { tag: 'story', text: 'tell me about a person who taught you something about this work.' },
  { tag: 'story', text: 'tell me about a time you got something really wrong, and what came of it.' },
  { tag: 'spicy', text: "what's a take you have about our sector that nobody asks for?" },
  { tag: 'spicy', text: 'what is something nonprofits should stop apologizing for?' },
  { tag: 'fun', text: "if you weren't doing this work, what would you be doing?" },
  { tag: 'fun', text: "what's the best thing you've eaten this month?" },
  { tag: 'fun', text: "what's a totally non-work thing you've been geeking out on lately?" },
  { tag: 'closer', text: 'who in this room should i meet next? why?' },
  { tag: 'closer', text: "what's something you're trying to make happen that someone here might help with?" },
];

function NewSessionInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get('id');
  const isEditing = Boolean(editId);

  const [step, setStep] = useState(1); // 1 basics, 2 rhythm, 3 prompts
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [rounds, setRounds] = useState(8);
  const [perRound, setPerRound] = useState(7);
  const [selected, setSelected] = useState([]);
  const [custom, setCustom] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(isEditing);

  // load an existing draft's config when editing
  useEffect(() => {
    if (!editId) return;
    let cancelled = false;
    fetch(`/api/sessions/${editId}/state?host=1`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d?.session) {
          setName(d.session.name || '');
          setCode(d.session.code || '');
          setRounds(d.session.rounds_total || 8);
          setPerRound(Math.round((d.session.round_seconds || 420) / 60));
          setSelected((d.session.prompts || []).map((p) => p.text).filter(Boolean));
        } else {
          showToast("couldn't load that draft", 'error');
        }
        setLoadingDraft(false);
      })
      .catch(() => {
        showToast("couldn't load that draft", 'error');
        setLoadingDraft(false);
      });
    return () => { cancelled = true; };
  }, [editId]);

  // auto-derive slug from name (only when not editing or slug still empty)
  function nameChange(v) {
    setName(v);
    if (!code) setCode(slugify(v));
  }

  function togglePrompt(p) {
    setSelected((s) => s.includes(p.text) ? s.filter((x) => x !== p.text) : [...s, p.text]);
  }
  function addCustom() {
    const t = custom.trim();
    if (!t) return;
    setSelected((s) => [...s, t]);
    setCustom('');
  }

  async function handlePublish(startNow) {
    if (selected.length < rounds) {
      setError(`pick at least ${rounds} prompts · one per round.`);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const url = isEditing ? `/api/sessions/${editId}` : '/api/sessions';
      const method = isEditing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name,
          code: slugify(code),
          rounds_total: rounds,
          round_seconds: perRound * 60,
          prompts: selected.map((text, i) => ({ id: i, text })),
          start_now: startNow,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { id } = await res.json();
      router.push(startNow ? `/host/s/${id || editId}` : '/host');
    } catch (e) {
      setError(e.message);
      setSubmitting(false);
    }
  }

  if (loadingDraft) {
    return (
      <main className="min-h-screen p-8 max-w-4xl mx-auto" style={{ background: '#f4f4f1' }}>
        <p className="text-neutral-500">[loading draft...]</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto" style={{ background: '#f4f4f1' }}>
      <header className="mb-8">
        <a href="/host" className="text-sm underline text-neutral-600">← back to dashboard</a>
        <div className="display text-4xl mt-3">{isEditing ? 'edit' : 'new'} Good Chats <span style={{ color: '#01ecf3' }}>*</span></div>
        <div className="flex gap-1 mt-3">
          <Step n={1} active={step === 1} done={step > 1} label="basics" />
          <Step n={2} active={step === 2} done={step > 2} label="rhythm" />
          <Step n={3} active={step === 3} done={false} label="prompts" />
        </div>
      </header>

      <div className="grid lg:grid-cols-[1fr,300px] gap-8">

        <div className="space-y-6">
          {step === 1 && (
            <div className="sticker bg-white rounded-md p-6">
              <h2 className="display text-xl mb-4">basics</h2>
              <Field label="event name">
                <input type="text" value={name} onChange={(e) => nameChange(e.target.value)} placeholder="november gather" className="w-full border-2 border-black rounded px-4 py-3 text-base" />
              </Field>
              <Field label="shareable link slug">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-neutral-500">wafg.app/r/</span>
                  <input type="text" value={code} onChange={(e) => setCode(slugify(e.target.value))} placeholder="november-gather" className="flex-1 border-2 border-black rounded px-4 py-3 font-mono text-base" />
                </div>
                <p className="text-xs text-neutral-500 mt-2">[this is the link you'll share on the event page]</p>
              </Field>
              <div className="flex justify-end mt-4">
                <button onClick={() => setStep(2)} disabled={!name || !code} className="btn-cyan px-6 py-3 rounded-md disabled:opacity-50">next: rhythm →</button>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="sticker bg-white rounded-md p-6">
              <h2 className="display text-xl mb-4">rhythm</h2>
              <Field label="max rounds">
                <input type="number" min={2} max={20} value={rounds} onChange={(e) => setRounds(parseInt(e.target.value) || 8)} className="w-32 border-2 border-black rounded px-4 py-3 text-base" />
                <p className="text-xs text-neutral-500 mt-2">
                  [ceiling · we auto-cap based on attendance to keep every pairing unique. with 10 people you'll get 9 rounds; with 6 people, 5.]
                </p>
              </Field>
              <Field label="minutes per round">
                <input type="number" min={2} max={15} value={perRound} onChange={(e) => setPerRound(parseInt(e.target.value) || 7)} className="w-32 border-2 border-black rounded px-4 py-3 text-base" />
              </Field>
              <p className="text-sm text-neutral-600 mt-2">
                up to ~{Math.round(rounds * (perRound + 0.5) + 5)} minutes [includes break + intro/closing] · usually shorter once auto-capped to attendance
              </p>
              <div className="flex justify-between mt-6">
                <button onClick={() => setStep(1)} className="text-sm underline">← back</button>
                <button onClick={() => setStep(3)} className="btn-cyan px-6 py-3 rounded-md">next: prompts →</button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="sticker bg-white rounded-md p-6">
              <h2 className="display text-xl mb-4">prompts</h2>
              <p className="text-sm text-neutral-600 mb-4">pick at least <strong>{rounds}</strong> · one drops per round.</p>

              <div className="space-y-2 mb-6 max-h-96 overflow-y-auto">
                {PROMPT_LIBRARY.map((p) => (
                  <button
                    key={p.text}
                    onClick={() => togglePrompt(p)}
                    className={`block w-full text-left p-3 rounded border-2 ${selected.includes(p.text) ? 'border-black' : 'border-neutral-200 hover:border-neutral-400'}`}
                    style={selected.includes(p.text) ? { background: '#01ecf3' } : {}}
                  >
                    <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-1">{p.tag}</div>
                    <div className="text-sm">{p.text}</div>
                  </button>
                ))}
              </div>

              {/* custom prompts (selected but not in the library) · shown as removable chips */}
              {selected.filter((t) => !PROMPT_LIBRARY.some((p) => p.text === t)).length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-2">your custom prompts</div>
                  <div className="space-y-2">
                    {selected.filter((t) => !PROMPT_LIBRARY.some((p) => p.text === t)).map((t) => (
                      <div key={t} className="flex items-center justify-between gap-2 p-3 rounded border-2 border-black" style={{ background: '#01ecf3' }}>
                        <span className="text-sm">{t}</span>
                        <button
                          onClick={() => setSelected((s) => s.filter((x) => x !== t))}
                          className="text-xs font-bold underline whitespace-nowrap"
                          title="remove"
                        >
                          remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <Field label="add a custom prompt">
                <div className="flex gap-2">
                  <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="your prompt here..." className="flex-1 border-2 border-black rounded px-4 py-2 text-base" />
                  <button onClick={addCustom} className="btn-black px-4 rounded">add *</button>
                </div>
              </Field>

              <div className="flex justify-between mt-6 pt-6 border-t-2 border-neutral-200">
                <button onClick={() => setStep(2)} className="text-sm underline">← back</button>
                <div className="flex gap-3">
                  <button onClick={() => handlePublish(false)} disabled={submitting || selected.length < rounds} className="px-6 py-3 rounded-md border-2 border-black bg-white disabled:opacity-50 font-semibold">
                    {isEditing ? 'save changes' : 'save as draft'}
                  </button>
                  <button onClick={() => handlePublish(true)} disabled={submitting || selected.length < rounds} className="btn-cyan px-6 py-3 rounded-md disabled:opacity-50">
                    {submitting ? 'working...' : 'go live now *'}
                  </button>
                </div>
              </div>
              {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
            </div>
          )}
        </div>

        {/* preview rail */}
        <aside className="bg-white sticker-sm rounded-md p-5 sticky top-8 self-start">
          <div className="text-[10px] uppercase tracking-widest font-bold opacity-60 mb-2">preview</div>
          <div className="display text-2xl mb-3">{name || 'untitled'}</div>
          <div className="text-xs text-neutral-500 mb-4 font-mono break-all">/r/{code || 'slug'}</div>
          <div className="text-sm space-y-1 text-neutral-700">
            <div>{rounds} rounds · {perRound} min each</div>
            <div>{selected.length} prompt{selected.length === 1 ? '' : 's'} picked</div>
          </div>
        </aside>

      </div>
    </main>
  );
}

function Step({ n, active, done, label }) {
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${active ? 'bg-black text-white' : done ? 'text-neutral-500' : 'text-neutral-400'}`}>
      <span>{done ? '✓' : n}</span> {label}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block mb-4">
      <div className="text-sm font-semibold mb-2">{label}</div>
      {children}
    </label>
  );
}

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}

export default function NewSessionPage() {
  return (
    <Suspense fallback={null}>
      <NewSessionInner />
    </Suspense>
  );
}
