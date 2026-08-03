// Resend email helper · recap emails only for now.
//
// env vars:
//   RESEND_API_KEY  · from resend.com → API Keys
//   RESEND_FROM     · verified sender address, e.g. "Good Chats <goodchats@weareforgood.com>"

const RESEND_API = 'https://api.resend.com/emails';

// sends a post-session recap to one participant.
// captures: [{ captured_name, captured_linkedin_url }]
// prompts:  [{ round_number, prompt_text }]  (from rounds table)
export async function sendRecapEmail({ to, participantName, sessionName, captures = [], prompts = [] }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';

  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set · skipping recap email');
    return { ok: false, reason: 'not configured' };
  }
  if (!to) return { ok: false, reason: 'no recipient' };

  const captureRows = captures.length > 0
    ? captures.map((c) => {
        const linkedinBtn = c.captured_linkedin_url
          ? `<a href="${c.captured_linkedin_url}" style="display:inline-block;background:#0a66c2;color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;margin-top:6px;">LinkedIn →</a>`
          : '';
        return `
          <li style="padding:12px 0;border-bottom:1px solid #e5e5e5;">
            <div style="font-weight:600;font-size:15px;">${escHtml(c.captured_name)}</div>
            ${linkedinBtn}
          </li>`;
      }).join('')
    : `<li style="padding:12px 0;color:#666;">no captures this session · next time tap the ✦ button during a conversation to save someone.</li>`;

  const promptRows = prompts.length > 0
    ? prompts.map((p) => `
        <li style="padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:14px;color:#333;">
          <span style="color:#01ecf3;font-weight:700;margin-right:8px;">${p.round_number}.</span>${escHtml(p.prompt_text)}
        </li>`).join('')
    : '';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">

        <!-- header -->
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">
              good<span style="color:#000;">*</span>chats
            </div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">that's a wrap, ${escHtml(participantName)}.</div>
          </td>
        </tr>

        <!-- body -->
        <tr>
          <td style="padding:28px 32px;">

            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">session</p>
            <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>

            <!-- captures -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">people you captured</p>
            <ul style="margin:0 0 28px;padding:0;list-style:none;border-top:1px solid #e5e5e5;">
              ${captureRows}
            </ul>

            ${prompts.length > 0 ? `
            <!-- prompts -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">tonight's prompts</p>
            <ul style="margin:0 0 28px;padding:0;list-style:none;border-top:1px solid #f0f0f0;">
              ${promptRows}
            </ul>` : ''}

          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0 0 12px;font-size:13px;color:#999;">
              what starts here, ripples →
            </p>
            <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://goodchats.weareforgood.com'}/profile" style="display:inline-block;background:#000;color:#01ecf3;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;">
              see your good chats history →
            </a>
            <p style="margin:12px 0 0;font-size:12px;color:#bbb;">
              We Are For Good · <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Your Good Chats recap · ${sessionName}`,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[resend] send failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] send error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

// sends a "verify your email" link to a brand-new joiner. their profile is
// created immediately so the live session isn't blocked, but recap emails
// and newsletter sync are held until they click through.
export async function sendVerificationEmail({ to, name, verifyUrl }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';

  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set · skipping verification email');
    return { ok: false, reason: 'not configured' };
  }
  if (!to) return { ok: false, reason: 'no recipient' };

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">

        <!-- header -->
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">
              good<span style="color:#000;">*</span>chats
            </div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">one quick thing, ${escHtml(name)}.</div>
          </td>
        </tr>

        <!-- body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.5;">
              confirm this is really your inbox so we know it's okay to send you a recap after the session
              [and, if you opted in, add you to the WAFG newsletter].
            </p>
            <a href="${verifyUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              confirm my email →
            </a>
            <p style="margin:20px 0 0;font-size:13px;color:#999;">
              [this link works for the next 48 hours. if this wasn't you, no action needed.]
            </p>
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              We Are For Good · <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `confirm your email · Good Chats`,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[resend] verification send failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] verification send error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

// sends a "the next session is on the calendar" email to one notify-list
// signup. only fires when a host explicitly opts a session into announcing
// (session.metadata.notify_list) — never automatically on every session.
export async function sendSessionAnnouncementEmail({ to, firstName, sessionName, sessionCode, startsAt }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';

  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set · skipping announcement email');
    return { ok: false, reason: 'not configured' };
  }
  if (!to) return { ok: false, reason: 'no recipient' };

  const joinUrl = `https://goodchats.weareforgood.com/r/${sessionCode}`;
  const dt = startsAt ? new Date(startsAt) : null;
  const whenLine = dt && !Number.isNaN(dt.getTime())
    ? dt.toLocaleString(undefined, { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
    : 'time TBD · watch your inbox for details';

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">

        <!-- header -->
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">
              good<span style="color:#000;">*</span>chats
            </div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">it's on the calendar, ${escHtml(firstName)}.</div>
          </td>
        </tr>

        <!-- body -->
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">next session</p>
            <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>
            <p style="margin:0 0 24px;font-size:15px;color:#333;">${escHtml(whenLine)}</p>
            <a href="${joinUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              save your spot →
            </a>
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              We Are For Good · <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${sessionName} · Good Chats is on the calendar`,
        html,
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[resend] announcement send failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] announcement send error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
