// kit.com (formerly ConvertKit) API helper.
// adds a subscriber to a configured sequence (preferred) or form.
//
// env vars:
//   KIT_API_KEY      · your Kit account's API key (from Settings → Advanced/Developer)
//   KIT_SEQUENCE_ID  · (optional) a sequence id · when set, joiners are added to
//                      this sequence so your set-up welcome/drip emails fire
//   KIT_FORM_ID      · (optional) a form id · used when no sequence id is set
//   KIT_LINKEDIN_FIELD · (optional) the key of a Kit custom field to store the
//                        joiner's linkedin url · defaults to "linkedin". create
//                        the field first in kit (Subscribers → custom fields).
//
// a sequence takes priority when both are present. if KIT_API_KEY plus at least
// one of the two ids is missing, this is a no-op (logs and returns false) and the
// join flow continues unaffected.

const KIT_BASE = 'https://api.convertkit.com/v3';

export async function addSubscriberToKit({ email, firstName, linkedinUrl }) {
  const apiKey = process.env.KIT_API_KEY;
  const sequenceId = process.env.KIT_SEQUENCE_ID;
  const formId = process.env.KIT_FORM_ID;
  const linkedinField = process.env.KIT_LINKEDIN_FIELD || 'linkedin';
  if (!apiKey || (!sequenceId && !formId)) {
    console.warn('[kit] KIT_API_KEY and one of KIT_SEQUENCE_ID / KIT_FORM_ID not set · skipping subscribe');
    return { ok: false, reason: 'kit not configured' };
  }
  if (!email) return { ok: false, reason: 'no email' };

  // a sequence drips your set-up emails, so prefer it when configured.
  const endpoint = sequenceId
    ? `${KIT_BASE}/sequences/${sequenceId}/subscribe`
    : `${KIT_BASE}/forms/${formId}/subscribe`;

  // map the linkedin url onto a kit custom field when we have one. kit silently
  // ignores fields that don't exist, so this is safe even before you create it.
  const fields = linkedinUrl ? { [linkedinField]: linkedinUrl } : undefined;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        email,
        first_name: firstName || undefined,
        fields,
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
