import { adminClient } from './supabase-server';
import { sendSessionAnnouncementEmail, sendGoingLiveEmail } from './resend';

// ============================================================================
// shared sending helper
// ============================================================================

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHUNK = 100;

// how many emails one request will send. resend allows ~2 requests/second, so we
// send two at a time with a gap, and a 429 gets one retry. 60-100 emails fit
// inside the route's 60s limit; anything beyond that is left for the next click.
const MAX_GO_LIVE_PER_RUN = 60;
const MAX_ANNOUNCE_PER_RUN = 100;
const STALE_PENDING_MS = 10 * 60 * 1000;

async function sendPooled(items, send, { concurrency = 2, gapMs = 700 } = {}) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      let r = await send(items[i]);
      if (!r?.ok && r?.reason === 'http 429') {
        await sleep(1500);
        r = await send(items[i]);
      }
      results[i] = r || { ok: false, reason: 'no result' };
      await sleep(gapMs);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

const norm = (e) => String(e || '').trim().toLowerCase();

// everyone who has clicked "unsubscribe". checked before EVERY send, for every kind of
// recipient. a missing table (one-time SQL not run yet) means nobody has unsubscribed via it
// so far; any other failure throws, because not being able to check must never turn into
// "email everyone anyway".
async function unsubscribedEmails(admin) {
  const { data, error } = await admin.from('email_unsubscribes').select('email').limit(20000);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return new Set();
    throw new Error(`could not check the unsubscribe list: ${error.message}`);
  }
  return new Set((data || []).map((r) => norm(r.email)));
}

// ============================================================================
// 1. "it's on the calendar" announcement · everyone who has never been emailed
// ============================================================================
//
// emails everyone still waiting to hear about "the next session" (rows in
// notify_signups with notified_at still null). only successfully-sent rows get
// stamped, so a failed send is retried the next time a session announces.
//
// called from the session create/update routes when the host explicitly opts a
// session into notify_list. the routes now AWAIT this (it used to be started and
// forgotten, and a serverless function can be frozen the moment it replies, so
// the emails often never went out and nothing was logged).
//
// returns { attempted, sent, failed, more, reason } so the host can be told what
// actually happened. `more` is true when there were more people waiting than one
// request will send; the session is then NOT marked as announced, so saving it
// again continues with the rest.
export async function notifyPendingSignups({ sessionName, sessionCode, startsAt }) {
  const admin = adminClient();
  // the form lets one person sign up more than once, so fetch extra rows: several can be the
  // same address, and a person must get ONE email however many times they signed up.
  const FETCH_LIMIT = MAX_ANNOUNCE_PER_RUN * 3 + 1;
  const { data: pending, error } = await admin
    .from('notify_signups')
    .select('id, email, first_name')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(FETCH_LIMIT);
  if (error) throw new Error(`could not read the notify list: ${error.message}`);
  const truncated = (pending || []).length >= FETCH_LIMIT;

  // one entry per address, in signup order
  const byEmail = new Map();
  for (const p of pending || []) {
    const e = norm(p.email);
    if (e && !byEmail.has(e)) byEmail.set(e, { email: e, first_name: p.first_name });
  }

  // anyone who unsubscribed is marked handled (by ADDRESS, so every one of their signups, even
  // ones beyond this fetch, stops occupying a slot in future batches) and never emailed
  const unsubscribed = await unsubscribedEmails(admin);
  const suppressed = [...byEmail.keys()].filter((e) => unsubscribed.has(e));
  if (suppressed.length > 0) {
    await admin
      .from('notify_signups')
      .update({ notified_at: new Date().toISOString() })
      .in('email', suppressed)
      .is('notified_at', null);
  }
  const unique = [...byEmail.values()].filter((p) => !unsubscribed.has(p.email));
  const more = unique.length > MAX_ANNOUNCE_PER_RUN || truncated;
  const batch = unique.slice(0, MAX_ANNOUNCE_PER_RUN);
  if (batch.length === 0) return { attempted: 0, sent: 0, failed: 0, more: false, reason: null };

  const results = await sendPooled(batch, (p) =>
    sendSessionAnnouncementEmail({
      to: p.email,
      firstName: p.first_name || 'friend',
      sessionName,
      sessionCode,
      startsAt,
    })
  );

  // stamp by ADDRESS so all of a person's signups are marked at once (a duplicate row left
  // unstamped would get them the NEXT session's announcement too)
  const sentEmails = batch.filter((_, i) => results[i]?.ok).map((p) => p.email);
  if (sentEmails.length > 0) {
    await admin
      .from('notify_signups')
      .update({ notified_at: new Date().toISOString() })
      .in('email', sentEmails)
      .is('notified_at', null);
  }
  const firstFailure = results.find((r) => !r?.ok);
  return {
    attempted: batch.length,
    sent: sentEmails.length,
    failed: batch.length - sentEmails.length,
    more,
    reason: firstFailure ? firstFailure.reason || 'failed' : null,
  };
}

// ============================================================================
// 2. "we're live" email · homepage signups who have never joined a session
// ============================================================================

// every homepage signup whose email has never joined a session. "joined" means a
// profile with that email has at least one participants row. if ANY lookup fails
// this throws, so a database hiccup can never turn into "email the whole list".
async function signupsWhoNeverJoined(admin) {
  const { data: signups, error } = await admin.from('notify_signups').select('email, first_name');
  if (error) throw new Error(`could not read the notify list: ${error.message}`);

  const byEmail = new Map();
  for (const s of signups || []) {
    const e = norm(s.email);
    if (e && !byEmail.has(e)) byEmail.set(e, { email: e, firstName: s.first_name || null });
  }

  const emails = [...byEmail.keys()];
  const joinedEmails = new Set();
  for (let i = 0; i < emails.length; i += CHUNK) {
    const part = emails.slice(i, i + CHUNK);
    const { data: profs, error: pe } = await admin.from('profiles').select('id, email').in('email', part);
    if (pe) throw new Error(`could not check who has joined before: ${pe.message}`);
    const profiles = profs || [];

    // small id chunks keep each participants query well under the row limit
    const joinedProfileIds = new Set();
    for (let j = 0; j < profiles.length; j += 25) {
      const ids = profiles.slice(j, j + 25).map((p) => p.id);
      const { data: parts, error: pae } = await admin
        .from('participants')
        .select('profile_id')
        .in('profile_id', ids)
        .limit(5000);
      if (pae) throw new Error(`could not check who has joined before: ${pae.message}`);
      for (const r of parts || []) joinedProfileIds.add(r.profile_id);
    }
    for (const p of profiles) if (joinedProfileIds.has(p.id)) joinedEmails.add(norm(p.email));
  }

  return [...byEmail.values()].filter((c) => !joinedEmails.has(c.email));
}

// people who saved their spot for THIS session on the "coming up" page. they asked for
// this session specifically, so they're emailed even if they've joined before. if the
// table hasn't been created yet this just returns none, so the rest keeps working.
async function rsvpsForSession(admin, sessionId) {
  const { data, error } = await admin
    .from('session_rsvps')
    .select('email, first_name')
    .eq('session_id', sessionId);
  if (error) {
    if (error.code === '42P01' || error.code === 'PGRST205') return [];
    throw new Error(`could not read saved spots: ${error.message}`);
  }
  return (data || []).map((r) => ({ email: norm(r.email), firstName: r.first_name || null }));
}

// where this session's go-live send stands: who is still eligible, and what the
// log already says. `eligible` excludes anyone already sent (or currently being sent).
export async function goLiveStatus(admin, sessionId) {
  const homepage = await signupsWhoNeverJoined(admin);
  const rsvps = await rsvpsForSession(admin, sessionId);

  // one entry per email; a saved spot wins (and keeps the name they gave)
  const merged = new Map();
  for (const c of homepage) merged.set(c.email, { ...c, source: 'homepage' });
  for (const r of rsvps) {
    const prev = merged.get(r.email);
    merged.set(r.email, { email: r.email, firstName: r.firstName || prev?.firstName || null, source: 'rsvp' });
  }
  // unsubscribed addresses are never candidates, whichever list they came from
  const unsubscribed = await unsubscribedEmails(admin);
  const candidates = [...merged.values()].filter((c) => !unsubscribed.has(c.email));

  const { data: logged, error } = await admin
    .from('session_notifications')
    .select('email, status, attempted_at')
    .eq('session_id', sessionId)
    .eq('kind', 'go-live');
  if (error) {
    const err = new Error(error.message);
    err.code = error.code;
    throw err;
  }

  const now = Date.now();
  const sent = new Set();
  const failed = new Set();
  const stale = new Set();
  const pendingFresh = new Set();
  for (const r of logged || []) {
    const e = norm(r.email);
    if (r.status === 'sent') sent.add(e);
    else if (r.status === 'failed') failed.add(e);
    else if (r.status === 'pending') {
      // a crash mid-send leaves rows pending forever; treat old ones as retryable
      if (now - new Date(r.attempted_at).getTime() > STALE_PENDING_MS) stale.add(e);
      else pendingFresh.add(e);
    }
  }
  const loggedAll = new Set([...sent, ...failed, ...stale, ...pendingFresh]);

  const eligible = candidates.filter((c) => !sent.has(c.email) && !pendingFresh.has(c.email));

  return {
    eligible,
    eligibleRsvps: eligible.filter((c) => c.source === 'rsvp').length,
    eligibleHomepage: eligible.filter((c) => c.source === 'homepage').length,
    brandNew: new Set(candidates.filter((c) => !loggedAll.has(c.email)).map((c) => c.email)),
    failed,
    stale,
    alreadySent: sent.size,
    failedCount: failed.size,
    totalCandidates: candidates.length,
  };
}

// true when the error just means the one-time SQL (session_notifications) hasn't been run
export function isMissingNotificationsTable(err) {
  const msg = String(err?.message || '');
  return err?.code === '42P01' || err?.code === 'PGRST205' || /session_notifications/.test(msg) && /does not exist|schema cache/i.test(msg);
}

// sends the go-live email to this session's eligible new signups.
// `expected` is the count the host saw and confirmed; if the list changed since,
// nothing is sent and the caller re-confirms. every recipient is CLAIMED in the
// log before sending (insert-or-skip for new rows, compare-and-swap for retries),
// so two simultaneous clicks cannot email the same person twice.
export async function sendGoLive(admin, session, { expected } = {}) {
  const st = await goLiveStatus(admin, session.id);

  if (typeof expected === 'number' && expected !== st.eligible.length) {
    return { mismatch: true, eligible: st.eligible.length };
  }

  const toSend = st.eligible.slice(0, MAX_GO_LIVE_PER_RUN);
  if (toSend.length === 0) return { attempted: 0, sent: 0, failed: 0, remaining: 0, reason: null };

  const nowIso = new Date().toISOString();
  const staleCutoff = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const base = (q) => q.eq('session_id', session.id).eq('kind', 'go-live');
  const claimed = [];

  // brand-new recipients: insert, skipping anyone another request got to first
  const fresh = toSend.filter((c) => st.brandNew.has(c.email));
  if (fresh.length > 0) {
    const { data, error } = await admin
      .from('session_notifications')
      .upsert(
        fresh.map((c) => ({ session_id: session.id, email: c.email, kind: 'go-live', status: 'pending', attempted_at: nowIso })),
        { onConflict: 'session_id,email,kind', ignoreDuplicates: true }
      )
      .select('email');
    if (error) throw new Error(`could not record the send: ${error.message}`);
    const got = new Set((data || []).map((r) => norm(r.email)));
    claimed.push(...fresh.filter((c) => got.has(c.email)));
  }

  // earlier failures: flip failed -> pending only if it is still failed
  const retry = toSend.filter((c) => st.failed.has(c.email));
  if (retry.length > 0) {
    const { data, error } = await base(admin.from('session_notifications').update({ status: 'pending', attempted_at: nowIso, error: null }))
      .eq('status', 'failed')
      .in('email', retry.map((c) => c.email))
      .select('email');
    if (error) throw new Error(`could not record the send: ${error.message}`);
    const got = new Set((data || []).map((r) => norm(r.email)));
    claimed.push(...retry.filter((c) => got.has(c.email)));
  }

  // abandoned sends (pending for > 10 min): take them over only if still stale
  const abandoned = toSend.filter((c) => st.stale.has(c.email));
  if (abandoned.length > 0) {
    const { data, error } = await base(admin.from('session_notifications').update({ attempted_at: nowIso, error: null }))
      .eq('status', 'pending')
      .lt('attempted_at', staleCutoff)
      .in('email', abandoned.map((c) => c.email))
      .select('email');
    if (error) throw new Error(`could not record the send: ${error.message}`);
    const got = new Set((data || []).map((r) => norm(r.email)));
    claimed.push(...abandoned.filter((c) => got.has(c.email)));
  }

  if (claimed.length === 0) return { attempted: 0, sent: 0, failed: 0, remaining: st.eligible.length, reason: null };

  const results = await sendPooled(claimed, (c) =>
    sendGoingLiveEmail({
      to: c.email,
      firstName: c.firstName || 'friend',
      sessionName: session.name,
      sessionCode: session.code,
    })
  );

  const sentEmails = claimed.filter((_, i) => results[i]?.ok).map((c) => c.email);
  if (sentEmails.length > 0) {
    await base(admin.from('session_notifications').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }))
      .in('email', sentEmails);
  }
  for (let i = 0; i < claimed.length; i++) {
    if (results[i]?.ok) continue;
    await base(admin.from('session_notifications').update({ status: 'failed', error: String(results[i]?.reason || 'failed').slice(0, 200) }))
      .eq('email', claimed[i].email);
  }

  const failures = results.filter((r) => !r?.ok);
  return {
    attempted: claimed.length,
    sent: sentEmails.length,
    failed: failures.length,
    remaining: Math.max(0, st.eligible.length - claimed.length),
    reason: failures[0] ? failures[0].reason || 'failed' : null,
  };
}
