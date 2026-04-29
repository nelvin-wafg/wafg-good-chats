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
- Sessions also enforce a 60-participant hard cap, server-side.

The rate limiter fails open if the database is unreachable, prioritizing availability over strict enforcement during outages. A periodic cleanup function (`cleanup_rate_limits()`) prunes records older than 1 hour.

Supabase's built-in auth rate limits cover the host magic-link flow (typically 4 emails per hour per IP, configurable in the Supabase dashboard).

---

## 9. Network and origin protection

- `SameSite=Lax` on the participant identity cookie prevents cross-site POST requests from carrying the cookie. This mitigates basic CSRF without requiring per-request CSRF tokens.
- All API routes are same-origin only. The default Next.js behavior does not enable wide CORS.
- Vercel's edge layer terminates TLS and provides DDoS protection at the platform level.

---

## 10. Secrets management

Six environment variables hold sensitive configuration:

- `NEXT_PUBLIC_SUPABASE_URL` (public)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public, gated by RLS)
- `SUPABASE_SERVICE_ROLE_KEY` (server-only, bypasses RLS)
- `DAILY_API_KEY` (server-only, used to mint Daily.co tokens)
- `DAILY_DOMAIN` (semi-public)
- `SESSION_SECRET` (server-only, used to sign participant identity cookies)

All secrets are stored in Vercel's encrypted environment variable store. None are committed to the repository. The `.env.example` file documents the required keys with placeholder values only. The `.gitignore` excludes `.env`, `.env.local`, and similar files.

The `SUPABASE_SERVICE_ROLE_KEY` is scoped to server-side usage only (`lib/supabase-server.js`); it is never imported or referenced in client components.

---

## 11. Audit and observability

Currently the application relies on:
- Vercel function logs (request-level).
- Supabase logs (query-level, retained per Supabase plan).
- The `rate_limits` table itself, which records every limited request with timestamp.

There is no application-level audit log of host actions (session creates, approvals, ends) or participant-level actions (joins, captures). This is a known gap, listed in section 12.

---

## 12. Known gaps and future hardening

The following items are known to be incomplete. They reflect the "small, private, invite-shared" threat profile this v1 was built for. Each should be addressed before broader deployment.

| Gap | Current risk | Recommendation |
|---|---|---|
| **Vercel deployment protection not enabled** | Preview deployments are publicly accessible at unique URLs. Low risk because URLs are not advertised, but technically discoverable. | Toggle Vercel Authentication on for Preview deployments in Project Settings → Deployment Protection. |
| **No application-level audit log** | Hard to investigate after-the-fact incidents. | Add an `audit_events` table; log host actions, approval changes, session lifecycle events. |
| **No CAPTCHA or bot detection on `/join`** | Sufficient for current trusted-link distribution; would not survive a brigading attempt against a public link. | Add a lightweight challenge (e.g., Turnstile) if usage broadens. |
| **No content moderation on participant names** | A participant can join with an offensive display name. Mitigated by host's ability to end the session early. | Add a profanity filter, optional host approval queue for joiners. |
| **Sit-out fairness in pairing algorithm** | The same participant can randomly sit out two rounds in a row when participant count is odd. UX issue, not security. | Bias the pairing algorithm to weight against repeat sit-outs. |
| **Capture endpoint resolves partner by display name** | If two participants share an exact display name, the wrong person could be captured. Edge case, low impact. | Pass and validate `partnerId` instead of `partnerName`. |
| **No backup/recovery plan for participant cookies** | Participants whose cookie is cleared mid-session must rejoin (and re-enter their name). Acceptable UX trade-off. | Optional: support a recover-by-link flow if requested. |
| **Single shared `SESSION_SECRET`** | Rotating the secret invalidates all in-flight participant cookies. | For future, support multiple active signing keys with kid-based rotation. |
| **Hobby plan gates collaboration on private repos** | Commits authored by accounts other than the project owner are blocked from deploying. Operationally confusing rather than insecure. | Upgrade to Pro plan, or make the repo public, or use only nelvin-wafg as the commit author. |

Items not listed above are explicitly out of scope for v1.

---

## 13. Compliance and privacy notes

For legal review, the following points are relevant:

- **Data minimization.** The application collects only what is required to operate a speed-networking session: email for hosts (for auth), display name for participants, basic session metadata, and capture history (which connections a participant wanted to remember). No PII beyond display name is collected from participants.
- **Data retention.** No automated deletion is currently implemented. Records remain in Supabase indefinitely. A retention policy should be defined (e.g., delete sessions older than 12 months, with capture exports available to participants on request).
- **Right to deletion.** Currently a manual SQL operation. A self-service delete flow (host-initiated, deletes session + participants + pairings + captures) is recommended before any GDPR/CCPA-eligible user is on-boarded.
- **Third-party processors.** Supabase (database + auth), Daily.co (video infrastructure), Vercel (hosting), GitHub (source control). All have published security posture documentation. Their data processing agreements should be reviewed by counsel.
- **Recording.** Daily.co rooms are configured WITHOUT recording in our default room creation parameters. If recording is enabled in the future, participants must be informed and consent obtained per applicable jurisdiction.
- **Cookies and tracking.** No third-party tracking or analytics is currently embedded. The only cookies set are session-management cookies (Supabase auth, participant identity), which are functionally necessary and not subject to consent banner requirements in most jurisdictions.

---

## 14. Change log

| Date | Change | Reviewed by |
|---|---|---|
| 2026-04-24 | Initial v1 deployment | (none, AI-assisted build) |
| 2026-04-26 | Hardening pass: HMAC participant cookies, RLS lockdown, rate limiting, input validation, daily.co token auth | Nelvin Johnson |

---

## 15. Contact

Questions or concerns about this document or the application's security posture: nelvin@givingbridgeconsulting.com.
