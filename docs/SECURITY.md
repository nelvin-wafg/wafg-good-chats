# Good Chats · Security Posture

**Project:** `wafg-good-chats`
**Live URL:** https://wafg-good-chats.vercel.app
**Last reviewed:** 2026-04-26
**Audience:** engineering review, legal review, We Are For Good leadership

---

## 1. Overview

Good Chats is a video-based speed networking application built for the We Are For Good community. Hosts create timed "sessions" where participants are auto-paired into 5-minute conversations across multiple rounds. The application replaces a third-party tool that was capped at 10 participants and offered no branding control.

This document describes the security and privacy controls in place as of the date above. It is intentionally honest about both what has been built and what has not. The application currently targets "small, private, invite-shared community sessions" as its threat profile. Any plans to broaden the audience (public sign-ups, paid usage, regulated data) should trigger a re-review against the gaps listed in section 12.

---

## 2. Architecture summary

| Layer | Technology | Notes |
|---|---|---|
| Hosting | Vercel (Hobby plan) | Auto-deploy from GitHub, serverless functions, HTTPS-only |
| Application | Next.js 14 (App Router) | React, server-side rendering, route handlers |
| Database & Auth | Supabase (Postgres) | Row-level security, magic-link auth for hosts |
| Video infrastructure | Daily.co | Custom UI, server-issued meeting tokens |
| Source control | GitHub (private repo) | `nelvin-wafg/wafg-good-chats` |

There are two trust tiers:
- **Hosts** authenticate via Supabase magic link (email-based, passwordless) and require an `is_approved` flag set by an admin.
- **Participants** are anonymous to the system. They join via a shareable link and supply only a display name. Identity within a session is bound to an HMAC-signed cookie issued by the server.

---

## 3. Threat model

Primary threats considered:

1. **Unauthorized session control.** A non-approved party gaining host-level control of a session.
2. **Session disruption.** A third party joining a session uninvited and degrading the experience.
3. **Identity spoofing.** A participant submitting captures or actions on behalf of another participant.
4. **Resource abuse.** Automated traffic flooding the system with fake joins or auth requests.
5. **Data exfiltration.** A party reading session data they should not have access to (other participants' info, capture lists, session histories).
6. **Credential exposure.** Secrets (API keys, service-role tokens) leaking through the codebase or runtime.

Out of scope for the current implementation:
- Sophisticated targeted attacks on the hosting infrastructure (handled by Vercel/Supabase).
- Defense against compromised host laptops (any host with valid login can do anything in their session).
- Defense against the Daily.co platform itself.

---

## 4. Authentication

### Hosts
- Authentication is **passwordless** via Supabase's `signInWithOtp` magic link flow. No passwords are stored or transmitted.
- Magic links are single-use and time-limited (10 minutes by default).
- Successful login establishes a Supabase-managed JWT session via `@supabase/ssr`, stored as HttpOnly cookies.
- Host records are auto-created on first login but have `is_approved = false` by default. An approved admin must flip the flag in SQL before access is granted.
- Magic-link redirect URLs are constrained to the app's own origin, configured in the Supabase project's "Redirect URLs" allowlist.

### Participants
- Participants are not authenticated against any external identity provider. They are anonymous to the system, identified only by a display name they choose.
- Upon joining a session, the server issues an **HMAC-SHA256 signed token** containing `(sessionId, participantId, iat, exp)`.
- The token is set as an `HttpOnly`, `SameSite=Lax`, `Secure` (in production) cookie. The participant client cannot read or modify it.
- Server-side handlers verify the cookie's signature and expiry on every authenticated request. Token TTL is 8 hours.
- The signing key (`SESSION_SECRET`) is a 32+ character random string stored only in Vercel's environment variable store.
- **Optional passwordless sign-in (profile page).** Nothing requires it; guests join exactly as before. A participant can ask for a one-time link at `/signin` (or use the "see your history" button in a recap email), sent to the profile's own inbox. Links are 32 random bytes; only the SHA-256 hash is stored (`login_tokens`), each works once and expires (15 minutes when asked for on `/signin`, 30 days when in a recap email). The link only opens a page: the token is spent by a button press (POST), so email scanners that pre-open links cannot use it up. The request endpoint gives the same answer whether or not a profile exists, and is limited per IP and per address. Using a link also marks the email verified.
- **Personal invite links and the referral tracker.** A signed-in member gets a random 9-character invite code (`/i/<code>`, unguessable, public by design, revocable by making a new one). Opening the link in a browser records one visit per browser (random visitor id in an `HttpOnly` cookie, never an email) and remembers the inviter for 30 days (`wafg_ref`, first link wins). Credit for "joined" is only given when that browser joins a call AND the person has never been in a call before; nobody can credit themselves; the inviter sees only a count and the first names of people who joined through their link. Signup/RSVP events store a hash of the email, not the address. Preview images show only the inviter's first name, the next call and a host-written question.
- **Tracked email links.** LinkedIn buttons in recap and follow-up emails go through `/go/<token>`. The token carries the real destination plus who/why, signed with `SESSION_SECRET`, so only destinations we signed are ever used (https links to LinkedIn or our own site); an altered or unknown token goes to the homepage, so it can't be used as an open redirect. The click is recorded in `link_clicks` (profile, session, kind, host, a bot flag). Email scanners that pre-open links can still look like clicks, so counts are an upper bound.
- **Day-after follow-up email.** One per person per call, sent from the daily job to verified, un-removed, not-unsubscribed participants who had partners; carries an unsubscribe link and the List-Unsubscribe headers; LinkedIn buttons only for people the recipient starred (names only for everyone else).
- Two profile cookies, on purpose: `wafg_pf` (6 months) is handed out by the join form to anyone who types an email, with **no proof they own it**, so it unlocks only low-sensitivity profile data. `wafg_si` (90 days, signed with a separate `signin:` prefix) exists only after a one-time link was used and is required for the private "people you've met" list.

---

## 5. Authorization

Every API route enforces authorization. Examples:

| Route | Authorization rule |
|---|---|
| `POST /api/sessions` | Authenticated host with `is_approved = true` |
| `POST /api/sessions/[id]/start` | Host who owns the session (`session.host_id == user.id`) |
| `POST /api/sessions/[id]/round` | Host who owns the session |
| `POST /api/sessions/[id]/end` | Host who owns the session |
| `POST /api/sessions/[id]/join` | Public; rate-limited; capacity-capped |
| `POST /api/sessions/[id]/capture` | Valid participant cookie matching the session |
| `GET /api/sessions/[id]/state` (host view) | Host who owns the session |
| `GET /api/sessions/[id]/state` (participant view) | Valid participant cookie returns this participant's assignment only |
| `POST /api/daily/token` | See below |

The Daily.co token endpoint deserves particular note because it gates access to the underlying video infrastructure:

- For `isOwner = true` requests: caller must be an authenticated approved host AND must be the host of the session that the requested room belongs to.
- For `isOwner = false` requests: caller must have a valid participant cookie for the session that the requested room belongs to. For pair rooms, the participant must be one of the two participants in that pairing.
- The endpoint cross-references the requested `roomName` against the database to identify which session it belongs to before applying these rules. Unknown room names return 404.

---

## 6. Data protection

### Row-level security
Supabase Row Level Security is enabled on every application table. The policy strategy is **deny by default** for anonymous traffic. Only the service role bypasses RLS, and the service role key is held server-side only (never sent to the browser). Specific policies:

- `hosts`: authenticated host can read their own row (`auth.uid() = id`).
- `sessions`: authenticated host can read and write their own sessions (`auth.uid() = host_id`).
- `participants`, `rounds`, `pairings`, `captures`, `rate_limits`: no anonymous policies. All access is via service-role API routes that perform their own authorization.

This means a leaked anon key does not grant any access to participant data. The previous v1 schema had loose anon read policies which were tightened in the 2026-04-26 hardening pass.

### Transport
All traffic to the application is HTTPS via Vercel's automatic TLS. Daily.co video streams use SRTP via Daily's infrastructure.

### Cookies
- Participant identity cookie: `HttpOnly`, `SameSite=Lax`, `Secure` in production, 8-hour expiry, scoped to the app domain.
- Invite cookies `wafg_ref` (30 days, who invited this browser) and `wafg_vid` (1 year, a random visitor id used only to count a visit once): both `HttpOnly`, `SameSite=Lax`, `Secure` in production.
- Profile cookie `wafg_pf` (6 months) and signed-in cookie `wafg_si` (90 days): both `HttpOnly`, `SameSite=Lax`, `Secure` in production, HMAC-signed. `wafg_si` is only issued after a one-time sign-in link is used.
- Supabase auth cookies: managed by `@supabase/ssr` with similar protections.

### Personal data
The application stores: host email and display name; participant display name; session metadata; pair history; capture records; client IP at join time (for rate-limit attribution).

It does NOT store: passwords, full names beyond what participants supply, payment information, government identifiers, location data, or chat transcripts. Daily.co handles video streams and does not record by default in our configuration.

---

## 7. Input validation

A central validation library (`lib/validate.js`) enforces strict server-side checks on all user-supplied inputs:

- Participant name: 1 to 48 characters, control characters stripped, whitespace normalized.
- Session name: 1 to 100 characters, same sanitization.
- Session URL slug: `[a-z0-9-]+`, 1 to 48 characters, no leading or trailing dashes.
- Round count: integer 1 to 20.
- Round duration: integer 30 to 1800 seconds.
- Prompt text: 1 to 240 characters per prompt; up to 30 prompts per session.
- Capture note: optional string up to 500 characters.
- All UUIDs validated against the standard UUID regex.

Validation failures return HTTP 400 with a brief error message; nothing user-supplied is reflected back unsanitized. React's auto-escaping handles XSS protection at the rendering layer (no use of `dangerouslySetInnerHTML`).

---

## 8. Rate limiting

A sliding-window rate limiter (`lib/rate-limit.js`) backed by the Supabase `rate_limits` table protects the public-facing endpoints:

- `POST /api/sessions/[id]/join`: 10 joins per IP per 60 seconds.
- `POST /api/daily/token`: 50 requests per IP per 300 seconds.
- `POST /api/profiles/lookup`: 20 per IP per 300 seconds, and only operable against a non-ended session (limits email enumeration to active session windows).
- Sessions also enforce a 60-participant hard cap, server-side.

The rate limiter fails open if the database is unreachable, prioritizing availability over strict enforcement during outages. A scheduled daily cron (`/api/cron/cleanup`, configured in `vercel.json`) calls `cleanup_rate_limits()` to prune records older than 1 hour.

Supabase's built-in auth rate limits cover the host magic-link flow (typically 4 emails per hour per IP, configurable in the Supabase dashboard).

---

## 9. Network and origin protection

- `SameSite=Lax` on the participant identity cookie prevents cross-site POST requests from carrying the cookie. This mitigates basic CSRF without requiring per-request CSRF tokens.
- All API routes are same-origin only. The default Next.js behavior does not enable wide CORS.
- Vercel's edge layer terminates TLS and provides DDoS protection at the platform level.

---

## 10. Secrets management

Environment variables holding sensitive configuration:

- `NEXT_PUBLIC_SUPABASE_URL` (public)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public, gated by RLS)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS)
- `DAILY_API_KEY` (server-only, used to mint Daily.co tokens)
- `DAILY_DOMAIN` (semi-public)
- `SESSION_SECRET` (server-only, signs every cookie and link we issue via HMAC-SHA256: participant, profile and signed-in cookies, email-verification, unsubscribe and tracked-link tokens)
- `SESSION_SECRET_PREVIOUS` (optional, server-only, one or more old signing keys separated by commas; things signed with them still verify, nothing new is signed with them; see "Rotating the signing key")
- `KIT_API_KEY` (server-only, newsletter sync — optional; absence disables sync)
- `KIT_FORM_ID` (server-only, Kit form to subscribe joiners to)
- `CRON_SECRET` (server-only — protects both scheduled endpoints, `/api/cron/cleanup` and `/api/cron/reminders` (the day-of reminder email to people who saved a spot); Vercel cron sends it as a bearer token, and with it unset both refuse every request)

All secrets are stored in Vercel's encrypted environment variable store. None are committed to the repository. The `.env.example` file documents the required keys with placeholder values only. The `.gitignore` excludes `.env`, `.env.local`, and similar files.

### Rotating the signing key

All signing goes through `lib/secrets.js`: it signs with `SESSION_SECRET` and verifies against `SESSION_SECRET` plus any `SESSION_SECRET_PREVIOUS`. To rotate with nobody logged out and no old link broken:

1. Generate a new random value (at least 32 characters).
2. In Vercel set `SESSION_SECRET_PREVIOUS` to the **old** `SESSION_SECRET`, and `SESSION_SECRET` to the **new** value. Redeploy.
3. Keep the previous key until everything it signed has expired or stopped mattering, then delete `SESSION_SECRET_PREVIOUS`.

How long to keep it: participant cookies 8 hours, email-verification links 48 hours, signed-in cookie 90 days, profile cookie 6 months. **Unsubscribe links and tracked email links never expire**, so removing the old key kills the unsubscribe link in every email sent before the rotation; keep the previous key as long as old emails should still work (a year is reasonable). If the old key was **leaked**, rotate and then remove the previous key straight away, accepting that older unsubscribe links and cookies stop working.

The `SUPABASE_SERVICE_ROLE_KEY` is scoped to server-side usage only (`lib/supabase-server.js`); it is never imported or referenced in client components.

---

## 11. Audit and observability

Currently the application relies on:
- Vercel function logs (request-level).
- Supabase logs (query-level, retained per Supabase plan).
- The `rate_limits` table, which records every limited request with timestamp.
- A `last_seen` heartbeat on each participant, updated every ~2 seconds while their tab is open. Used for presence/pairing accuracy and to eject genuinely-disconnected participants (stale heartbeat > 12s) from live rooms.
- A scheduled daily cron that prunes `rate_limits` and reaps abandoned sessions (active sessions where all participants have been gone > 1 hour, or empty sessions older than 6 hours).

There is no application-level audit log of host actions (session creates, approvals, ends, deletes) or participant-level actions (joins, captures). This remains a known gap, listed in section 12.

---

## 12. Known gaps and future hardening

The following items are known to be incomplete. They reflect the "small, private, invite-shared" threat profile this v1 was built for. Each should be addressed before broader deployment.

| Gap | Current risk | Recommendation |
|---|---|---|
| **Vercel deployment protection not enabled** | Preview deployments are publicly accessible at unique URLs. Low risk because URLs are not advertised, but technically discoverable. | Toggle Vercel Authentication on for Preview deployments in Project Settings → Deployment Protection. |
| **No application-level audit log** | Hard to investigate after-the-fact incidents. | Add an `audit_events` table; log host actions, approval changes, session lifecycle events. |
| **No CAPTCHA or bot detection on `/join`** | Sufficient for current trusted-link distribution; would not survive a brigading attempt against a public link. | Add a lightweight challenge (e.g., Turnstile) if usage broadens. |
| **No content moderation on participant names** | A participant can join with an offensive display name. Mitigated by host's ability to end the session early. | Add a profanity filter, optional host approval queue for joiners. |
| **No backup/recovery plan for participant cookies** | Participants whose cookie is cleared mid-session must rejoin. A persistent profile cookie (6-month, HMAC-signed) now recognizes returning users on the same device. | Optional: support a recover-by-link flow if requested. |
| **One signing key for everything** | If the key leaked, an attacker could forge any cookie or link until it was replaced. Rotation is now painless (see section 10), but it is still a single key shared by every token type; the `signin:`, `unsubscribe:` and `track:` prefixes keep tokens from being valid as each other. | Separate keys per token type if the threat model ever calls for it. Rotate on a schedule (e.g. yearly) and immediately on any suspected leak. |
| **Hobby plan gates collaboration on private repos** | Commits authored by accounts other than the project owner are blocked from deploying. Operationally confusing rather than insecure. | Upgrade to Pro plan, or make the repo public, or use only nelvin-wafg as the commit author. |
| **Referral credit can be gamed with throwaway emails** | Credit is given when a brand-new profile joins its first call through an invite link. Someone could create fake emails to inflate their own "people you brought" count. Harmless while the count is only shown to the member, but it would matter if recognition or rewards were ever tied to it. | Before attaching any reward: require the invitee to attend a full session (e.g. 3+ completed rounds) and have a verified email, and cap credit per day. |
| **Notify sign-up can re-subscribe an unsubscribed address** | `/api/notify` clears an earlier unsubscribe for whatever address is typed ("a deliberate fresh yes"), with no proof the typer owns the inbox. A stranger could re-add someone who opted out to the one-time announcement email. | Make a sign-up for a previously unsubscribed address require a confirmation click (double opt-in) before it is re-added. |
| **Join form: residual after the 2026-11-07 fix** | Typing an existing member's email no longer overwrites their profile, subscribes them to the newsletter, hands out their profile cookie, or takes over their live seat. Remaining, lower risk: (1) someone can pre-create a profile for an email that has never joined, and holds its creator cookie until the owner signs in; (2) `/api/profiles/lookup` confirms whether an email is a member and returns their display name (rate-limited per IP only); (3) a join with an existing email still links that session's seat to the profile, so the owner's recap email can mention a session they did not attend. | (1) invalidate creator cookies when the owner verifies; (2) return nothing without a session-bound challenge or add a CAPTCHA; (3) only link an unproven join to the profile once the owner confirms. `PROFILE_COOKIE_MIN_IAT` can invalidate all profile cookies in an emergency. |

Items not listed above are explicitly out of scope for v1.

---

## 13. Compliance and privacy notes

For legal review, the following points are relevant. **Note: the data collected expanded materially in the 2026-04-29 update** — participants are now asked for email and (optionally) LinkedIn, and opted-in emails are synced to a third-party email marketing platform (Kit). This changes the privacy profile from the original v1.

- **Personal data collected from participants:** display name (required), email (required to join), LinkedIn URL (optional), and capture history (which other participants they wanted to stay in touch with — including a snapshot of those people's name, email, and LinkedIn at capture time). Client IP is recorded at join for rate-limit attribution.
- **Newsletter sync (consent).** The join form includes a checkbox, **unchecked by default** (affirmative opt-in), reading "add me to the WAFG newsletter [unsubscribe anytime]." The participant must actively check it. Only when checked is the email sent to Kit (ConvertKit) to subscribe them. This unticked-by-default design aligns with GDPR's affirmative-consent standard and is well within US CAN-SPAM. Returning users keep their previously chosen state.
- **Sharing between participants.** A participant's LinkedIn URL is shown to the people they're paired with during a session. Their email and LinkedIn are included in the post-session recap shown to anyone who "captured" them. The join form discloses this ("shown to people you're paired with so they can connect").
- **Data export.** Hosts can export full participant lists (name, email, LinkedIn, capture counts) as CSV per session and across all sessions. This data leaves the system in the host's control · downstream handling (e.g., import to a CRM) is outside the app's controls and should be governed by WAFG's data policy.
- **Spreadsheet formulas in exports.** CSV cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return are prefixed with an apostrophe (`lib/csv.js`), so a signup named like a formula opens as plain text in Excel/Sheets. Real numbers are untouched.
- **Response headers** (`next.config.js`): `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (unsubscribe/verify links carry tokens in the URL), a `Permissions-Policy` that turns off geolocation/payment/USB (camera and microphone are deliberately not restricted so calls keep working), and `X-Frame-Options: SAMEORIGIN` on `/host/*` and `/unsubscribe`. A `Content-Security-Policy-Report-Only` header logs violations to the browser console without blocking; enforce it once a real event runs clean. Next's image optimizer is switched off (`images.unoptimized`) because the app never uses `next/image`.
- **Dependencies.** `npm audit` is the check. Next.js was moved 14.2.16 -> 14.2.35 (clears the middleware authorization bypass and about a dozen others). About two dozen advisories remain that are only fixed in Next 15/16 (mostly denial-of-service in Server Components / Server Actions / the image optimizer, none of which this app exposes beyond the platform's own limits); moving to Next 16 is a separate, larger upgrade.
- **Untrusted text in email.** Everything a visitor types (names, emails, links) is HTML-escaped before it goes into an email, including the host's "someone signed up" ping, and recap LinkedIn buttons only render for http(s) links.
- **Data retention.** No automated deletion of personal data. Sessions can be hard-deleted by the host who created them, or by an admin (cascades to participants, pairings, captures). The daily cron reaps abandoned sessions but does NOT delete personal data on a schedule. A formal retention policy should be defined.
- **Right to deletion / access.** Host-initiated session delete exists. There is no participant-facing self-service delete or data-access request flow. Recommended before onboarding any GDPR/CCPA-eligible user at scale.
- **Third-party processors.** Supabase (database + auth), Daily.co (video infrastructure), Vercel (hosting), Kit/ConvertKit (newsletter), GitHub (source control). Each has published security documentation; their data processing agreements should be reviewed by counsel, with particular attention to Kit given it now receives participant emails.
- **Recording.** Daily.co rooms are configured WITHOUT recording in our default parameters. Pair-room text chat is ephemeral (in-memory, not persisted). If recording is enabled in future, informed consent is required per jurisdiction.
- **Cookies.** Two functional cookies: a session participant identity cookie (HttpOnly, 8h) and a persistent profile-recognition cookie (HttpOnly, 6 months). Both are HMAC-signed and functionally necessary. No third-party tracking or advertising cookies. The 6-month persistent cookie may warrant disclosure in a cookie notice depending on jurisdiction.

---

## 14. Change log

| Date | Change | Reviewed by |
|---|---|---|
| 2026-04-24 | Initial v1 deployment | (none, AI-assisted build) |
| 2026-04-26 | Hardening pass: HMAC participant cookies, RLS lockdown, rate limiting, input validation, daily.co token auth | Nelvin Johnson |
| 2026-04-29 | Lead-gen + features: profiles (email + LinkedIn), Kit newsletter sync, persistent profile cookie, co-host model (any approved host can run any session; only primary host can delete), participant + host recap views, CSV export, analytics page, presence heartbeat, ghost-participant eject by unique ID, scheduled cleanup/reaper cron, draft editing. **Privacy profile expanded — see section 13.** | Nelvin Johnson |
| 2026-11-04 | Hardening pass: dropped the `sessions host all` row-level-security policy (all session writes go through the API's service key), added response headers + report-only CSP, Next.js 14.2.35, CSV formula neutralizing, escaped the host sign-up email, image optimizer off. | Nelvin Johnson |
| 2026-10-29 | Session deletion widened from creator-only to creator **or admin**; audit log marks `byAdmin` and `creatorId`. Non-admin co-hosts remain creator-only. | Nelvin Johnson |
| 2026-11-06 | Optional passwordless sign-in for the profile page (one-time email links, hashed in `login_tokens`, spent by POST), separate inbox-verified `wafg_si` cookie gating the private "people you've met" list; recap email lists every partner by name (LinkedIn still only for starred); sign-in pages not frameable. Found and documented the join-form overwrite gap (section 12). | Nelvin Johnson |
| 2026-11-07 | Join-form trust fix: an existing profile is only edited, subscribed to the newsletter or given its cookie when the browser already holds a cookie for it (signed-in link or earlier join); an unproven caller still joins but the stored profile is untouched; an unproven caller cannot take over a live seat (409); optional `PROFILE_COOKIE_MIN_IAT` env lever to invalidate old profile cookies. | Nelvin Johnson |
| 2026-11-07 | Profile is the one-stop page: next-call card (save a spot / join / calendar / notify toggle), personal invite links with a referral tracker (`referral_events`, `profiles.invite_code`, `profiles.referred_by`), invite landing page + preview image. Calls-based levels removed. Documented the remaining referral-gaming risk in section 12. | Nelvin Johnson |
| 2026-11-07 | Day-after follow-up email ("who do you want to talk to again?", a ready-to-send note per person, runs inside the daily reminders job), signed click tracking for LinkedIn links (`/go/<token>`, `link_clicks`), personal invite line in the recap, and an "after the call" card on the host dashboard. | Nelvin Johnson |
| 2026-11-08 | Invite page sign-up: LinkedIn optional (invite page only), one "you're on the list" welcome email naming the inviter, limited to invite sign-ups, one per address per hour, never to an address that had unsubscribed (checked before the sign-up clears the unsubscribe). Noted: the existing sign-up clears an earlier unsubscribe for any typed address, which lets a stranger re-add someone to the announcement list; fix is to require email confirmation (section 12). | Nelvin Johnson |
| 2026-11-09 | Signing-key rotation: all six token types (participant, profile and signed-in cookies, email-verification, unsubscribe and tracked links) now sign with `SESSION_SECRET` and also verify against optional `SESSION_SECRET_PREVIOUS` via `lib/secrets.js`, so the key can be replaced without logging anyone out or breaking old emails. | Nelvin Johnson |

---

## 15. Contact

Questions or concerns about this document or the application's security posture: nelvin@givingbridgeconsulting.com.
