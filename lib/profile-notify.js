// the homepage "tell me when the next one is scheduled" list, as a simple on/off for one email.
// same rules as the homepage form and the unsubscribe page, kept in one place for the profile's
// toggle. server-only.
//
//   on   = the address has a notify_signups row AND is not in email_unsubscribes
//   join = add a row if there isn't one, and clear an earlier unsubscribe (a deliberate fresh yes)
//   leave= stop the announcement and record the unsubscribe (what the unsubscribe page does)
export async function isOnNotifyList(admin, email) {
  const [{ data: rows }, { data: unsubs }] = await Promise.all([
    admin.from('notify_signups').select('id').eq('email', email).limit(1),
    admin.from('email_unsubscribes').select('email').eq('email', email).limit(1),
  ]);
  return (rows || []).length > 0 && (unsubs || []).length === 0;
}

export async function joinNotifyList(admin, { email, firstName, source }) {
  const { data: existing, error: lookupErr } = await admin.from('notify_signups').select('id').eq('email', email).limit(1);
  if (lookupErr) throw lookupErr;
  if (!existing || existing.length === 0) {
    const { error } = await admin.from('notify_signups').insert({
      email,
      first_name: firstName || null,
      source: String(source || 'profile').slice(0, 120),
      subscribed_to_weekly: false,
    });
    if (error) throw error;
  }
  await admin.from('email_unsubscribes').delete().eq('email', email);
}

export async function leaveNotifyList(admin, email, source = 'profile') {
  await admin.from('notify_signups').update({ notified_at: new Date().toISOString() }).eq('email', email).is('notified_at', null);
  const { error } = await admin.from('email_unsubscribes').upsert([{ email, source }], { onConflict: 'email', ignoreDuplicates: true });
  if (error) throw error;
}
