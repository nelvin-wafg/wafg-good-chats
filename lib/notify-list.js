// the host's view of the homepage notify list (Supabase table notify_signups).
//
// the form lets one person sign up more than once, so the table can hold several rows per
// email. everything here collapses to ONE entry per person, which is also how the announcement
// email counts people (it sends once per address).
//
// status, in priority order:
//   unsubscribed  they clicked unsubscribe (email_unsubscribes); never emailed
//   waiting       has at least one signup that hasn't been emailed yet: they will get the next
//                 announcement
//   emailed       every signup has already been emailed

const MISSING_TABLE = (e) => e?.code === '42P01' || e?.code === 'PGRST205';
const norm = (e) => String(e || '').trim().toLowerCase();

// pure: raw rows in, one entry per person out. signups: [{ email, first_name, linkedin_url,
// source, subscribed_to_weekly, created_at, notified_at }]; unsubscribed: Set of lowercased emails.
export function buildNotifyList(signups, unsubscribed = new Set()) {
  const people = new Map();
  for (const s of signups || []) {
    const email = norm(s.email);
    if (!email) continue;
    let p = people.get(email);
    if (!p) {
      p = {
        email,
        name: null,
        linkedin: null,
        source: null,
        inKitWeekly: false,
        firstSignedUp: s.created_at || null,
        lastSignedUp: s.created_at || null,
        signups: 0,
        anyUnemailed: false,
        lastEmailedAt: null,
      };
      people.set(email, p);
    }
    p.signups += 1;
    if (s.created_at) {
      if (!p.firstSignedUp || s.created_at < p.firstSignedUp) p.firstSignedUp = s.created_at;
      // the most recent signup's details win (people fix typos and add a LinkedIn later)
      if (!p.lastSignedUp || s.created_at >= p.lastSignedUp) {
        p.lastSignedUp = s.created_at;
        if (s.first_name) p.name = s.first_name;
        if (s.linkedin_url) p.linkedin = s.linkedin_url;
        if (s.source) p.source = s.source;
      }
    }
    if (!p.name && s.first_name) p.name = s.first_name;
    if (!p.linkedin && s.linkedin_url) p.linkedin = s.linkedin_url;
    if (!p.source && s.source) p.source = s.source;
    if (s.subscribed_to_weekly) p.inKitWeekly = true;
    if (!s.notified_at) p.anyUnemailed = true;
    else if (!p.lastEmailedAt || s.notified_at > p.lastEmailedAt) p.lastEmailedAt = s.notified_at;
  }

  const rows = [...people.values()].map((p) => ({
    email: p.email,
    name: p.name,
    linkedin: p.linkedin,
    source: p.source,
    inKitWeekly: p.inKitWeekly,
    firstSignedUp: p.firstSignedUp,
    signups: p.signups,
    lastEmailedAt: p.lastEmailedAt,
    status: unsubscribed.has(p.email) ? 'unsubscribed' : p.anyUnemailed ? 'waiting' : 'emailed',
  }));
  // newest signups first
  rows.sort((a, b) => (b.firstSignedUp || '').localeCompare(a.firstSignedUp || ''));

  const count = (st) => rows.filter((r) => r.status === st).length;
  return {
    rows,
    summary: {
      total: rows.length,
      waiting: count('waiting'),
      emailed: count('emailed'),
      unsubscribed: count('unsubscribed'),
      inKitWeekly: rows.filter((r) => r.inKitWeekly && r.status !== 'unsubscribed').length,
    },
  };
}

// reads Supabase and builds the view. a missing unsubscribe table (one-time SQL not run yet)
// just means nobody has unsubscribed through it so far.
export async function loadNotifyList(admin) {
  const { data: signups, error } = await admin
    .from('notify_signups')
    .select('email, first_name, linkedin_url, source, subscribed_to_weekly, created_at, notified_at')
    .order('created_at', { ascending: false })
    .limit(10000);
  if (error) throw new Error(`could not read the notify list: ${error.message}`);

  let unsubscribed = new Set();
  const { data: unsubs, error: uerr } = await admin.from('email_unsubscribes').select('email').limit(20000);
  if (uerr) {
    if (!MISSING_TABLE(uerr)) throw new Error(`could not read the unsubscribe list: ${uerr.message}`);
  } else {
    unsubscribed = new Set((unsubs || []).map((r) => norm(r.email)));
  }
  return buildNotifyList(signups || [], unsubscribed);
}
