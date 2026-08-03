import { adminClient } from './supabase-server';
import { sendSessionAnnouncementEmail } from './resend';

// emails everyone still waiting to hear about "the next session" (rows in
// notify_signups with notified_at still null) that this one just went out.
// only successfully-sent rows get stamped — a failed send is retried the next
// time a session announces, rather than silently lost.
//
// called fire-and-forget from the session create/update routes when the host
// explicitly opts a session into notify_list — never automatically for every
// session, since notify_signups holds real public subscribers.
export async function notifyPendingSignups({ sessionName, sessionCode, startsAt }) {
  const admin = adminClient();
  const { data: pending = [] } = await admin
    .from('notify_signups')
    .select('id, email, first_name')
    .is('notified_at', null);

  if (!pending || pending.length === 0) return;

  const results = await Promise.allSettled(
    pending.map((p) =>
      sendSessionAnnouncementEmail({
        to: p.email,
        firstName: p.first_name || 'friend',
        sessionName,
        sessionCode,
        startsAt,
      })
    )
  );

  const sentIds = pending
    .filter((_, i) => results[i]?.status === 'fulfilled' && results[i].value?.ok)
    .map((p) => p.id);

  if (sentIds.length > 0) {
    await admin.from('notify_signups').update({ notified_at: new Date().toISOString() }).in('id', sentIds);
  }
}
