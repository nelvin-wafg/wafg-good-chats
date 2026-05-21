# Spread Good Chats · Security Posture

**Project:** `wafg-good-chats`
**Live URL:** https://wafg-good-chats.vercel.app
**Last reviewed:** 2026-04-26
**Audience:** engineering review, legal review, We Are For Good leadership

---

## 1. Overview

Spread Good Chats is a video-based speed networking application built for the We Are For Good community. Hosts create timed "sessions" where participants are auto-paired into 5-minute conversations across multiple rounds. The application replaces a third-party tool that was capped at 10 participants and offered no branding control.

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
- `SESSION_SECRET` (server-only, signs participant identity + profile cookies via HMAC-SHA256)
- `KIT_API_KEY` (server-only, newsletter sync — optional; absence disables sync)
- `KIT_FORM_ID` (server-only, Kit form to subscribe joiners to)
- `CRON_SECRET` (server-only, optional — protects the scheduled cleanup endpoint; Vercel cron sends it as a bearer token)

All secrets are stored in Vercel's encrypted environment variable store. None are committed to the repository. The `.env.example` file documents the required keys with placeholder values only. The `.gitignore` excludes `.env`, `.env.local`, and similar files.

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
| **Single shared `SESSION_SECRET`** | Rotating the secret invalidates all in-flight participant cookies. | For future, support multiple active signing keys with kid-based rotation. |
| **Hobby plan gates collaboration on private repos** | Commits authored by accounts other than the project owner are blocked from deploying. Operationally confusing rather than insecure. | Upgrade to Pro plan, or make the repo public, or use only nelvin-wafg as the commit author. |

Items not listed above are explicitly out of scope for v1.

---

## 13. Compliance and privacy notes

For legal review, the following points are relevant. **Note: the data collected expanded materially in the 2026-04-29 update** — participants are now asked for email and (optionally) LinkedIn, and opted-in emails are synced to a third-party email marketing platform (Kit). This changes the privacy profile from the original v1.

- **Personal data collected from participants:** display name (required), email (required to join), LinkedIn URL (optional), and capture history (which other participants they wanted to stay in touch with — including a snapshot of those people's name, email, and LinkedIn at capture time). Client IP is recorded at join for rate-limit attribution.
- **Newsletter sync (consent).** The join form includes a checkbox, checked by default, reading "add me to the WAFG newsletter [unsubscribe anytime]." When checked, the participant's email is sent to Kit (ConvertKit) to subscribe them. **Counsel should confirm that a pre-checked opt-in meets the consent standard for the jurisdictions WAFG operates in** — notably, GDPR generally requires unticked/affirmative opt-in, while US CAN-SPAM is more permissive. If WAFG has EU/UK participants, the default-checked box likely needs to become unchecked-by-default.
- **Sharing between participants.** A participant's LinkedIn URL is shown to the people they're paired with during a session. Their email and LinkedIn are included in the post-session recap shown to anyone who "captured" them. The join form discloses this ("shown to people you're paired with so they can connect").
- **Data export.** Hosts can export full participant lists (name, email, LinkedIn, capture counts) as CSV per session and across all sessions. This data leaves the system in the host's control · downstream handling (e.g., import to a CRM) is outside the app's controls and should be governed by WAFG's data policy.
- **Data retention.** No automated deletion of personal data. Sessions can be hard-deleted by their primary host (cascades to participants, pairings, captures). The daily cron reaps abandoned sessions but does NOT delete personal data on a schedule. A formal retention policy should be defined.
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

---

## 15. Contact

Questions or concerns about this document or the application's security posture: nelvin@givingbridgeconsulting.com.
