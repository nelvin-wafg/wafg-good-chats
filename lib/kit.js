// kit.com (formerly ConvertKit) API helper.
// adds a subscriber to a configured form/list.
//
// env vars required:
//   KIT_API_KEY  · your Kit account's API key (from Account → Settings → Developer)
//   KIT_FORM_ID  · the form id to subscribe new joiners to
//
// if either env var is missing, this is a no-op (logs and returns false). the join flow continues.

const KIT_BASE = 'https://api.convertkit.com/v3';

export async function addSubscriberToKit({ email, firstName }) {
  const apiKey = process.env.KIT_API_KEY;
  const formId = process.env.KIT_FORM_ID;
  if (!apiKey || !formId) {
    console.warn('[kit] KIT_API_KEY or KIT_FORM_ID not set · skipping subscribe');
    return { ok: false, reason: 'kit not configured' };
  }
  if (!email) return { ok: false, reason: 'no email' };

  try {
    const res = await fetch(`${KIT_BASE}/forms/${formId}/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        email,
        first_name: firstName || undefined,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[kit] subscribe failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[kit] subscribe error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}
