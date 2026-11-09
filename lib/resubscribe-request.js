// asks an address that had unsubscribed to confirm it wants back on the list. server-only.
// at most one confirmation email per address per hour, so a sign-up form can't be used to pester someone.
import { createHash } from 'crypto';
import { checkRateLimit } from './rate-limit';
import { sendResubscribeConfirmEmail } from './resend';

export async function requestResubscribeConfirmation({ email, firstName }) {
  try {
    const bucket = `resubscribe-email:${createHash('sha256').update(String(email).toLowerCase()).digest('hex').slice(0, 32)}`;
    const { ok } = await checkRateLimit(bucket, 1, 3600);
    if (!ok) return { sent: false, reason: 'rate limited' };
    const r = await sendResubscribeConfirmEmail({ to: email, firstName });
    return { sent: Boolean(r && r.ok) };
  } catch (e) {
    console.warn('[resubscribe] could not request a confirmation', e?.message || e);
    return { sent: false, reason: 'error' };
  }
}
