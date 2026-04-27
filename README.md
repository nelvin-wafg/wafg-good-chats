# wafg-good-chats

**Spread Good Chats** — speed networking app for the We Are For Good community.

WAFG-branded video pairs, auto-rotating rounds, prompts, capture-the-connection, post-event recap. Built standalone (not a Zoom integration) so we control the whole experience.

---

## stack

- **next.js 14** (app router) + **tailwind** — UI
- **vercel** — hosting + serverless functions
- **supabase** — postgres + magic-link auth
- **daily.co** — video infrastructure (custom UI, we render the tiles)

---

## one-time setup (no terminal needed)

### 1. github

1. Sign in to github.com
2. New repository → name `wafg-good-chats`, public, no README/gitignore (we have them)
3. Upload all files in this folder to the repo (drag and drop in github web UI works fine)

### 2. supabase

1. Sign in to supabase.com → New project
2. Project name: `wafg-good-chats`, region nearest you, set a strong DB password
3. Wait for it to provision (~2 min)
4. Project Settings → API → copy the **Project URL** and the **anon public** key. You'll need these in step 4.
5. SQL Editor → New query → paste contents of `lib/schema.sql` → Run
6. After schema runs, paste the approval SQL block at the bottom of `lib/schema.sql` to approve hosts (Nelvin / Jon / Becky)

### 3. daily.co

1. Sign in to daily.co → Developers → API keys → copy your API key
2. Note your domain (e.g. `wafg.daily.co` → domain is `wafg`)

### 4. vercel

1. Sign in to vercel.com → Add New → Project → import the github repo
2. Framework preset: Next.js (auto-detected)
3. Environment Variables → paste the values from `.env.example`:
   - `NEXT_PUBLIC_SUPABASE_URL` — from supabase step 2.4
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — from supabase step 2.4
   - `SUPABASE_SERVICE_ROLE_KEY` — supabase Project Settings → API → service_role
   - `DAILY_API_KEY` — from daily step 3.1
   - `DAILY_DOMAIN` — from daily step 3.2
   - `NEXT_PUBLIC_APP_URL` — your vercel URL once deployed (e.g. `https://wafg-good-chats.vercel.app`), update after first deploy
   - `SESSION_SECRET` — long random string (32+ chars) used to sign participant cookies. Generate via 1password, bitwarden, or `https://generate-secret.vercel.app/64`. Never commit the real value.
4. Deploy. Vercel runs `npm install` and `npm run build` automatically.

### 5. supabase auth callback

1. Supabase → Authentication → URL Configuration
2. Site URL: your vercel app URL (e.g. `https://wafg-good-chats.vercel.app`)
3. Redirect URLs: add `https://your-app.vercel.app/auth/callback`

---

## architecture

```
participant flow:
  click link → /r/[code] (enter name) → /r/[code]/room (main room)
                                          ↓
                         (host clicks "kick it off")
                                          ↓
                              auto-pair into rooms (round 1)
                                          ↓
                              5 min · prompt visible · capture button
                                          ↓
                              return to main room briefly (10s)
                                          ↓
                              auto-pair (round 2) ... etc
                                          ↓
                              final return to main room (closing)

host flow:
  /host/login (magic link) → /host (dashboard) → /host/new (create session)
                                                        ↓
                                              /host/s/[id] (live control)
```

session state machine: `draft` → `live` → `running_round` → `between_rounds` → `closing` → `ended`

---

## file map

```
app/
  layout.jsx                    root layout, fonts, brand css
  globals.css                   tailwind + brand utilities
  page.jsx                      bare landing (redirects or splash)
  r/[code]/
    page.jsx                    participant join (name entry)
    room/page.jsx               THE main experience (main room + pair rooms + transitions)
  host/
    login/page.jsx              magic link login
    page.jsx                    dashboard (sessions list, live now, stats)
    new/page.jsx                session setup (create/edit)
    s/[id]/page.jsx             live host control room
  api/
    auth/callback/route.js      magic-link callback
    sessions/route.js           POST = create session
    sessions/[id]/start/route.js          start the session (creates main daily room)
    sessions/[id]/round/route.js          start/end a round (creates/destroys pair rooms)
    sessions/[id]/end/route.js            close session
    sessions/[id]/join/route.js           participant joins a session
    sessions/[id]/capture/route.js        save a capture
    sessions/[id]/state/route.js          GET current session state for participant polling
    daily/token/route.js                  generate daily access token
components/
  Asterisk.jsx
  ParticipantTile.jsx
  HostBadge.jsx
lib/
  brand.js                      color tokens for inline styles
  supabase-browser.js           browser client
  supabase-server.js            server client
  daily.js                      daily.co API helpers
  pairing.js                    matching algorithm (no-repeats, odd-count handling)
  schema.sql                    full database schema + RLS policies
middleware.js                   guards /host/* routes
```

---

## the pairing algorithm

In `lib/pairing.js`. Greedy round-robin with no-repeats memory. For odd participant counts, one person rotates through a "sit out" spot each round (gets paired with the host or a "join the next" message). Late joiners get folded in at next round break.

---

## brand

Cyan `#01ecf3`, soft cyan `#54d1de`, black, white. Archivo Black for display, Inter for body, Caveat for script accents. Lowercase casual copy with bracket asides. Hand-drawn asterisk `*` as ornament.

Voice rules (do not violate):
- no em dashes
- no AI-slop phrases ("dive in", "unleash", "elevate")
- bracket asides like `[we see you]` are okay and on-brand
- lowercase as default, sentence case for emphasis only

---

## deploy & iterate cycle

After first deploy:

1. Test the participant flow end to end by sharing a `/r/[code]` link with yourself in two browser windows
2. Test a real session with Jon and Becky as a dry run
3. Run with WAFG members on a small (4-8 person) calendar event before bigger ones

Bug? Edit the file in github, vercel auto-deploys.
trigger redeploy with correct author

