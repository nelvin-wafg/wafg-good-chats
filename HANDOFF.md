# Good Chats · Project Handoff

This document exists so a fresh Claude session (new account, new laptop, new context) can pick up working on this project without re-discovering everything from scratch. If you're a new Claude reading this, start here.

---

## What this project is

**Good Chats** is a WAFG-branded speed networking web app built for the We Are For Good community. It replaces a 10-cap Zoom + randomizer setup. Standalone (not a Zoom integration). Auto-rotating seven-minute video pairings with prompts each round, a capture-the-connection feature, post-event recap, and now a public landing page with a notify-list signup.

**Live URL:** https://goodchats.weareforgood.com (also at https://wafg-good-chats.vercel.app)
**Public landing:** the root `/` (public; explains the project + notify form)
**Host login:** small link in the landing footer
**Participant flow:** `/r/{session-code}` (open with the link)
**Host dashboard:** `/host`

**First live event:** May 2026, 12 participants. Mostly smooth. Subsequent iteration based on that debrief.

---

## Who Nelvin is

Nelvin runs WAFG operations and is the primary host. He doesn't code. All deploys are manual via GitHub Desktop. He's signed into Desktop as **nelvin-wafg** (the GitHub account that owns the repo and matches the Vercel project owner). The Hobby Vercel plan only builds commits from the project owner, so author identity matters.

He values warm, honest, plainly-stated writing. The brand voice tilts informal and human. He doesn't want AI-flavored copy. Specifically:

- **No em dashes.** Use periods, commas, "or", or rephrase.
- **No AI-slop phrases.** "I hope this finds you well." "Just wanted to reach out." "Touch base." "Per our discussion." Three-adjective stacks ("thoughtful, warm, and inspiring"). All disallowed.
- **Standard sentence caps** for prose. Lowercase is reserved for UI labels and brand marks (e.g. the display heading "good\*chats", the eyebrow "good chats · happening now").
- **Contractions are fine.** Specific nouns over generic ones. Short sentences. Fragments are fine.

If you write something and aren't sure, read it out loud. If it sounds like a LinkedIn post, rewrite.

---

## Tech stack

- **Frontend:** Next.js 14 App Router, React 18, Tailwind CSS
- **Backend:** Next.js API routes (server-side, no separate backend)
- **DB:** Supabase (Postgres with RLS), service role from server-side routes
- **Video:** Daily.co (custom call-object UI, not the prebuilt iframe)
- **Auth:** Supabase magic-link for hosts; HMAC-signed HttpOnly cookies for participants
- **Newsletter / notify list:** Kit (formerly ConvertKit), v3 API
- **Hosting:** Vercel (auto-deploys from main branch)
- **Cron:** Vercel cron daily at 04:00 UTC (rate-limit cleanup + stale session reaper)

All secrets live in Vercel env vars. Nothing sensitive should ever end up in the repo. Required env vars:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `DAILY_API_KEY`, `DAILY_DOMAIN`
- `NEXT_PUBLIC_APP_URL`
- `SESSION_SECRET` (32+ chars, used for HMAC cookies)
- `CRON_SECRET` (random string, gates cron endpoint)
- `KIT_API_KEY` + `KIT_SEQUENCE_ID` (preferred) or `KIT_FORM_ID`
- Optional: `KIT_LINKEDIN_FIELD`, `KIT_SOURCE_FIELD` (default to `linkedin` and `source`)

See `.env.example` for the full annotated list.

---

## Architecture in one paragraph

A session belongs to a host, has a status (`draft` → `live` → `running_round` → `between_rounds` (legacy, now skipped) → `closing` → `ended`), a list of prompts, a count of rounds, a per-round duration. Participants join via `/r/{code}`, get a participant cookie, poll `/api/sessions/[id]/state` every 2 seconds. Pairings are written to a `pairings` table each round; the participant client reads its `assignment` from the state response and decides which Daily room to join. Rounds auto-advance via a 1-second heartbeat on the host's tab, server-time driven so a backgrounded host tab doesn't break it. The host can broadcast a banner, send a private DM to a flagged participant, kick people, place anyone into a specific pair room. Captures are snapshotted at the moment of the tap so they survive profile changes.

---

## The story (v0 → v3)

This narrative is in `lib/story.js` and surfaces in the dashboard via the "the story →" link. Snapshot below:

**v0 · Sketch (Early 2026).** Designs and brand decisions. Mockups for main room, pair rooms, splitting transition. The format premise: auto-rotating timed pairings with prompts. The capture-the-connection idea.

**v1 · First Build (Spring 2026).** Next.js + Supabase + Daily.co on Vercel. Magic-link host login. Pairing algorithm with no-repeats. Auto-rotating rounds + prompts. Pair rooms and main room. Security baseline: RLS, rate limits, HMAC cookies.

**v2 · First Live Event (Late spring 2026).** Profiles, LinkedIn, recap, Kit, co-host. Light WAFG palette. Two-way pair-room chat. Brand renamed "Spread Good Chats" → "Good Chats." May 2026 first live event with 12 people.

**v3 · Built for Scale (June 2026, current).** Post-event debrief work. Bug fixes (phantom names, duplicate rejoins, iOS audio, heartbeat-DB sync). Round auto-advance via server-time heartbeat. Video polish (bigger labels, three view modes, device switcher). Mid-round control (orphan handling, place-into-room, kick, broadcast). Flag/SOS with chime and two-way help thread. Waiting room. Public landing page with notify-list signup.

---

## Deploy recipe (the workflow Nelvin uses)

Every code change follows this exact pattern. He's built muscle memory; don't innovate the steps.

```
1. Open GitHub Desktop → it shows the changed file(s)
2. Bottom-left: confirm the commit author avatar is nelvin-wafg
3. Commit message: "<short imperative message I suggest>"
4. Click "Commit to main"
5. Click "Push origin" (top bar)
6. Wait ~30s → reload the live URL → verify the change
```

End every code-change response with that exact recipe. If multiple files changed, list them in step 1. Keep numbering and phrasing consistent.

The web editor at github.com/nelvin-wafg/wafg-good-chats is a fallback if Desktop misbehaves.

---

## Brand conventions

- **Brand mark:** `good*chats` (lowercase, cyan asterisk between)
- **Primary colors:** off-white `#f4f4f1`, cyan `#01ecf3`, black
- **Fonts:** Archivo Black for display, Inter for body, Caveat for script
- **Tagline:** "what starts here, ripples →" (appears in recap + landing reward box)
- **Asterisks are the WAFG motif.** Use them as accents, separators, button suffixes (e.g. "kick it off *", "save your spot *").
- **Sub-brand context:** Good Chats is one product inside the We Are For Good community.

---

## External services to remember

- **Vercel:** Build automatically on push to main. Owner: nelvin-wafg. Custom domain: goodchats.weareforgood.com.
- **Supabase:** Project paused on free tier if inactive. If anything mysteriously stops working, check that the project is still running.
- **Daily.co:** Free tier is ~10,000 participant-minutes/month. Heavy testing chews through this. ~11 events of 20 people × 45 min before the cap.
- **Kit:** Sequence subscription tagged "good-chats-lead" for notify-list signups. LinkedIn maps to custom field `linkedin`. Source notes map to `source`.

---

## Where we left off

Public landing page just shipped (`/`). Features:

- Full-viewport hero with brand mark and tagline
- "Why this exists ↓" scroll cue pinned to bottom of hero, smooth-scrolls to why section
- Why section is now also full-viewport with a "How it works ↓" cue at its bottom, mirroring the hero pattern
- Conditional "next session" card pulled from `/api/landing` when host has published one
- Three-step "how it works" with a wide black reward banner for the "stay in touch" promise
- Notify form: email + first name + LinkedIn (all required) + "what brought you here?" (optional)
- Form submits to `/api/notify` → Kit with tag `good-chats-lead`
- Footer with WAFG attribution and small "host login →" link

The publish-to-landing toggle and "starts at" datetime were added to the new-session wizard (step 1, basics). Default for publish is ON.

Recent micro-iterations on landing copy:
- Sentence caps throughout (lowercase reserved for UI labels)
- Em dashes scrubbed
- "Why this exists" no longer doubles as both eyebrow and cue
- "How it works" same — only the clickable scroll cue remains
- Footer copy: "We Are For Good is a community for nonprofit and social impact / professionals who are changing the world."

---

## Unfinished / known gaps

- **Capture-list email send.** The landing reward box says "Your follow-up list is right there at the end of the session. Yours to take and follow up with!" — this is true (on-screen recap), but does NOT send an email. Building the email send (likely via Resend) is a meaningful next-step to make the promise stronger. Soften-copy was accepted as an interim.
- **Custom domain.** App lives at `wafg-good-chats.vercel.app` today. Custom domain planned.
- **Whitelabel / multi-tenant.** Discussed but explicitly deferred. Path A (lightweight licensing per-deployment) is the realistic first step.
- **Mobile app.** Discussed. PWA recommended over native if revisited.

---

## How to bootstrap a new Claude session

1. Clone the repo from GitHub (`nelvin-wafg/wafg-good-chats`) in the new Cowork workspace folder.
2. Point Claude at the workspace.
3. First message to Claude: "Read HANDOFF.md and confirm you have full context."
4. From there, work as usual.

Memory files (the in-house feedback / project / reference memos) don't transfer between Claude accounts. The most important conventions are baked into this doc — voice, deploy recipe, brand. If a new Claude needs more depth on any specific past decision, ask Nelvin and he'll explain.
