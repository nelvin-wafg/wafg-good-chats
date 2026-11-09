// Resend email helper · recap emails only for now.
//
// env vars:
//   RESEND_API_KEY  · from resend.com → API Keys
//   RESEND_FROM     · verified sender address, e.g. "Good Chats <goodchats@weareforgood.com>"

import { unsubscribePageUrl, unsubscribeApiUrl } from './unsubscribe';

const RESEND_API = 'https://api.resend.com/emails';

// every email to the notify list / saved spots carries an unsubscribe link in the footer AND
// the standard List-Unsubscribe headers (the one-click "Unsubscribe" button gmail and apple
// mail show next to the sender). if the link can't be built (no SESSION_SECRET) we do NOT
// send the email without one.
function unsubscribeFor(to) {
  try {
    return { page: unsubscribePageUrl(to), api: unsubscribeApiUrl(to) };
  } catch (e) {
    console.error('[resend] could not build an unsubscribe link', e?.message || e);
    return null;
  }
}
function unsubscribeHeaders(u) {
  return { 'List-Unsubscribe': `<${u.api}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

// sends a post-session recap to one participant.
// captures: [{ captured_name, captured_linkedin_url }]
// prompts:  [{ round_number, prompt_text }]  (from rounds table)
// partners: [{ round, roomLabel, name, starred }]  everyone they were paired with, names only
//           (see lib/recap-partners.js) · LinkedIn links stay with deliberate captures
// inviteUrl: the person's personal invite link (/i/<code>) for the "know someone who'd love this?" line
// historyUrl: one-time sign-in link for the "see your history" button (see lib/login-link.js);
//           falls back to the plain /profile page when there isn't one
export async function sendRecapEmail({ to, participantName, sessionName, captures = [], prompts = [], partners = [], historyUrl = null, inviteUrl = null }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';

  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set · skipping recap email');
    return { ok: false, reason: 'not configured' };
  }
  if (!to) return { ok: false, reason: 'no recipient' };

  const captureRows = captures.length > 0
    ? captures.map((c) => {
        // only a plain web link becomes a button, and it is escaped for the href attribute
        const linkedinBtn = /^https?:\/\//i.test(c.captured_linkedin_url || '')
          ? `<a href="${escHtml(c.captured_linkedin_url)}" style="display:inline-block;background:#0a66c2;color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;margin-top:6px;">LinkedIn →</a>`
          : '';
        return `
          <li style="padding:12px 0;border-bottom:1px solid #e5e5e5;">
            <div style="font-weight:600;font-size:15px;">${escHtml(c.captured_name)}</div>
            ${linkedinBtn}
          </li>`;
      }).join('')
    : `<li style="padding:12px 0;color:#666;">No one starred this time · tap the ✦ button during a conversation to star someone and get their LinkedIn.</li>`;

  // everyone they were paired with, in round order · names only so they can look people up later.
  // people they starred show a ✦ (their LinkedIn button is in the section above).
  const partnerRows = partners.length > 0
    ? partners.map((p) => {
        const where = [p.round ? `round ${p.round}` : null, p.roomLabel || null].filter(Boolean).join(' · ');
        return `
          <li style="padding:10px 0;border-bottom:1px solid #f0f0f0;font-size:15px;color:#000;">
            <span style="font-weight:600;">${escHtml(p.name)}</span>${p.starred ? ' <span style="color:#01ecf3;font-weight:700;">✦</span>' : ''}
            ${where ? `<div style="font-size:12px;color:#888;margin-top:2px;">${escHtml(where)}</div>` : ''}
          </li>`;
      }).join('')
    : '';

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

            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Session</p>
            <p style="margin:0 0 24px;font-size:18px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>

            <!-- captures -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">People you starred ✦</p>
            <ul style="margin:0 0 28px;padding:0;list-style:none;border-top:1px solid #e5e5e5;">
              ${captureRows}
            </ul>

            ${partners.length > 0 ? `
            <!-- everyone they were paired with · names only -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Everyone you were paired with</p>
            <ul style="margin:0 0 6px;padding:0;list-style:none;border-top:1px solid #f0f0f0;">
              ${partnerRows}
            </ul>
            <p style="margin:0 0 28px;font-size:12px;color:#999;">Forgot to star someone? Look them up on LinkedIn by name.</p>` : ''}

            ${prompts.length > 0 ? `
            <!-- prompts -->
            <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Tonight's prompts</p>
            <ul style="margin:0 0 28px;padding:0;list-style:none;border-top:1px solid #f0f0f0;">
              ${promptRows}
            </ul>` : ''}

          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0 0 12px;font-size:13px;color:#999;">
              What starts here, ripples →
            </p>
            <a href="${escHtml(historyUrl || `${process.env.NEXT_PUBLIC_APP_URL || 'https://goodchats.weareforgood.com'}/profile`)}" style="display:inline-block;background:#000;color:#01ecf3;padding:8px 16px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;">
              see your good chats history →
            </a>
            ${inviteUrl ? `<p style="margin:16px 0 0;font-size:13px;color:#555;line-height:1.5;">Know someone who'd love this? <a href="${escHtml(inviteUrl)}" style="color:#000;font-weight:700;">send them your personal invite →</a></p>` : ''}
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
        subject: `Your good chats recap · ${sessionName}`,
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
              Confirm this is really your inbox so we know it's okay to send you a recap after the session
              [and, if you opted in, add you to the WAFG newsletter].
            </p>
            <a href="${verifyUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              Confirm my email →
            </a>
            <p style="margin:20px 0 0;font-size:13px;color:#999;">
              [This link works for the next 48 hours. If this wasn't you, no action needed.]
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
        subject: `Confirm your email · good chats`,
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

// the one-time sign-in link, sent when someone asks for it on /signin. transactional: it goes
// only to the address that asked, so (like the verification email) it has no unsubscribe link.
export async function sendLoginLinkEmail({ to, name, url, minutes = 15 }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';
  if (!apiKey) {
    console.warn('[resend] RESEND_API_KEY not set · skipping sign-in email');
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
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">good<span style="color:#000;">*</span>chats</div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">your sign-in link${name ? `, ${escHtml(name)}` : ''}.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 20px;font-size:15px;color:#333;line-height:1.5;">Tap the button to see your good chats history. No password needed.</p>
            <a href="${escHtml(url)}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">Sign in →</a>
            <p style="margin:20px 0 0;font-size:13px;color:#999;">this link works once and expires in ${minutes} minutes. If you didn't ask for it, ignore this email and nothing happens.</p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">We Are For Good · <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a></p>
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: 'Your good chats sign-in link', html }),
    });
    if (!res.ok) {
      console.error('[resend] sign-in link send failed', res.status, await res.text());
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] sign-in link send error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

// the day-after follow-up: "who do you want to talk to again?". one email per person per session.
// partners: [{ name, round, roomLabel, prompt, linkedinUrl }]  (linkedinUrl only for people they
// starred, already wrapped as a tracked link by the caller). each partner gets a copy-and-send
// message so the hardest part, starting the note, is done. carries an unsubscribe link.
export async function sendFollowUpEmail({ to, firstName, sessionName, partners = [], inviteUrl = null }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';
  if (!apiKey) return { ok: false, reason: 'not configured' };
  if (!to) return { ok: false, reason: 'no recipient' };
  if (!partners.length) return { ok: false, reason: 'nobody to follow up with' };
  const unsub = unsubscribeFor(to);
  if (!unsub) return { ok: false, reason: 'unsubscribe not configured' };

  const name = firstName ? escHtml(firstName) : 'friend';
  const rows = partners.map((p) => {
    const first = String(p.name || '').trim().split(/\s+/)[0] || 'there';
    const where = [p.round ? `round ${p.round}` : null, p.roomLabel || null].filter(Boolean).join(' · ');
    const draft = `Hi ${first}, we were paired up on good chats and I really enjoyed our conversation. Would love to keep it going. Are you up for a longer chat sometime?`;
    const button = /^https?:\/\//i.test(p.linkedinUrl || '')
      ? `<a href="${escHtml(p.linkedinUrl)}" style="display:inline-block;background:#0a66c2;color:#fff;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;margin-top:8px;">message ${escHtml(first)} on LinkedIn →</a>`
      : `<div style="font-size:12px;color:#888;margin-top:8px;">find ${escHtml(first)} on LinkedIn by name.</div>`;
    return `
          <tr><td style="padding:16px 0;border-bottom:1px solid #eee;">
            <div style="font-weight:700;font-size:16px;color:#000;">${escHtml(p.name)}</div>
            ${where || p.prompt ? `<div style="font-size:12px;color:#888;margin-top:2px;">${escHtml(where)}${where && p.prompt ? ' · ' : ''}${p.prompt ? `the question: \u201C${escHtml(p.prompt)}\u201D` : ''}</div>` : ''}
            <div style="margin-top:8px;padding:10px 12px;background:#f4f4f1;border-radius:6px;font-size:13px;color:#333;line-height:1.5;">${escHtml(draft)}</div>
            ${button}
          </td></tr>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">good<span style="color:#000;">*</span>chats</div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">who do you want to talk to again, ${name}?</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">${escHtml(sessionName)}</p>
            <p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.5;">The best conversations don't have to end after seven minutes. A short note while it's fresh is how a good chat turns into a friendship. We've drafted one for each person you met; copy it, make it yours, send it.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #eee;">${rows}
            </table>
            ${inviteUrl ? `<p style="margin:24px 0 0;font-size:14px;color:#333;line-height:1.5;">Know someone who'd love this? <a href="${escHtml(inviteUrl)}" style="color:#000;font-weight:700;">send them your personal invite →</a></p>` : ''}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              You're getting this because you joined a good chats call. We Are For Good ·
              <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a> ·
              <a href="${unsub.page}" style="color:#999;">unsubscribe</a>.
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `Who do you want to talk to again? \u00B7 ${sessionName}`, html, headers: unsubscribeHeaders(unsub) }),
    });
    if (!res.ok) {
      console.error('[resend] follow-up failed', res.status, await res.text());
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] follow-up error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

// "you're on the list": sent once to someone who signs up on a friend's invite page while no call is
// scheduled, so they don't fill in a form and then hear nothing for weeks. says who invited them,
// what Good Chats is, and that exactly one email comes when the next call is scheduled.
export async function sendInviteWelcomeEmail({ to, firstName, invitedBy }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';
  if (!apiKey) return { ok: false, reason: 'not configured' };
  if (!to) return { ok: false, reason: 'no recipient' };
  const unsub = unsubscribeFor(to);
  if (!unsub) return { ok: false, reason: 'unsubscribe not configured' };

  const name = firstName ? escHtml(firstName) : 'friend';
  const who = invitedBy ? escHtml(invitedBy) : 'a friend';
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">good<span style="color:#000;">*</span>chats</div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">you're on the list, ${name}.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 14px;font-size:15px;color:#333;line-height:1.5;"><strong>${who}</strong> invited you to good chats: six one-on-one conversations in about 45 minutes, with people doing good. Joyful, energetic, and over before you know it.</p>
            <p style="margin:0 0 14px;font-size:15px;color:#333;line-height:1.5;">There's no call on the calendar yet. When the next one is scheduled we'll send you <strong>one email</strong> with the date and a link to save your spot. Nothing else until then.</p>
            <a href="https://goodchats.weareforgood.com" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">What is good chats? →</a>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">You're getting this because you signed up at a good chats invite page. We Are For Good · <a href="${unsub.page}" style="color:#999;">unsubscribe</a>.</p>
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: "You're on the good chats list", html, headers: unsubscribeHeaders(unsub) }),
    });
    if (!res.ok) {
      console.error('[resend] invite welcome failed', res.status, await res.text());
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] invite welcome error', e?.message || e);
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
  const unsub = unsubscribeFor(to);
  if (!unsub) return { ok: false, reason: 'unsubscribe not configured' };

  const joinUrl = `https://goodchats.weareforgood.com/r/${sessionCode}`;
  const dt = startsAt ? new Date(startsAt) : null;
  const whenLine = dt && !Number.isNaN(dt.getTime())
    ? formatWhenET(dt)
    : 'Time TBD · watch your inbox for details';

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
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Next session</p>
            <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>
            <p style="margin:0 0 8px;font-size:15px;color:#333;">${escHtml(whenLine)}</p>
            <p style="margin:0 0 24px;font-size:13px;color:#777;line-height:1.5;">
              The room opens 5 minutes before we start. Use the button to see the details and add it to your calendar.
            </p>
            <a href="${joinUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              Save your spot →
            </a>
          </td>
        </tr>

        <!-- footer -->
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              We Are For Good · <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>
              · <a href="${unsub.page}" style="color:#999;">unsubscribe</a>
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
        subject: `${sessionName} · good chats is on the calendar`,
        html,
        headers: unsubscribeHeaders(unsub),
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

export function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// "we're live right now" email, sent when the host presses "send now" on the live
// dashboard. goes only to homepage signups who have never joined a session (see
// lib/notify.js) so it reads as an invitation, not a nag. returns { ok, reason? }.
export async function sendGoingLiveEmail({ to, firstName, sessionName, sessionCode }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';

  if (!apiKey) return { ok: false, reason: 'not configured' };
  if (!to) return { ok: false, reason: 'no recipient' };
  const unsub = unsubscribeFor(to);
  if (!unsub) return { ok: false, reason: 'unsubscribe not configured' };

  const joinUrl = `https://goodchats.weareforgood.com/r/${encodeURIComponent(sessionCode)}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">
              good<span style="color:#000;">*</span>chats
            </div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">we're live, ${escHtml(firstName)}.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Happening now</p>
            <p style="margin:0 0 14px;font-size:20px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>
            <p style="margin:0 0 24px;font-size:15px;color:#333;line-height:1.5;">
              You signed up to hear when good chats happens. The room is open and we're about to start,
              and it's a good one to jump into. Seven minutes, one good person at a time.
            </p>
            <a href="${joinUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              Join now →
            </a>
            <p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.5;">
              Tip: use Chrome, allow your mic and camera when asked, and you'll do a quick mic check in the waiting room first.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              You're getting this because you signed up for good chats updates at
              <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>.
              We Are For Good. <a href="${unsub.page}" style="color:#999;">unsubscribe</a>
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `${sessionName} · we're live, come join`,
        html,
        headers: unsubscribeHeaders(unsub),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[resend] go-live send failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] go-live send error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

// emails are rendered on the server, which runs in UTC, so "toLocaleString()" printed
// times like "5:30 PM UTC" for a 12:30 Eastern session. we don't know each reader's
// timezone, so print Eastern explicitly (the community's home timezone) and always link
// to the page, which shows the time in the reader's own timezone.
export function formatWhenET(date) {
  return `${date.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })} ET`;
}

// sent right after someone saves their spot on the "coming up" page. says what they
// signed up for, when it starts, when the doors open, and gives them the link.
// confirmations promise a reminder only when the session is at least this far away (the daily
// reminder job covers sessions starting within 25 hours of its daily run, so slack keeps the promise true)
const RSVP_REMINDER_PROMISE_MS = 26 * 60 * 60 * 1000;

export async function sendRsvpConfirmationEmail({ to, firstName, sessionName, sessionCode, startsAt }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';
  if (!apiKey) return { ok: false, reason: 'not configured' };
  if (!to) return { ok: false, reason: 'no recipient' };
  const unsub = unsubscribeFor(to);
  if (!unsub) return { ok: false, reason: 'unsubscribe not configured' };

  const joinUrl = `https://goodchats.weareforgood.com/r/${encodeURIComponent(sessionCode)}`;
  const start = startsAt ? new Date(startsAt) : null;
  const hasStart = start && !Number.isNaN(start.getTime());
  const whenLine = hasStart ? formatWhenET(start) : 'Time to be announced';
  const opensLine = hasStart
    ? `${new Date(start.getTime() - 5 * 60 * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`
    : null;
  const name = firstName ? escHtml(firstName) : 'friend';
  // the day-of reminder (see sendRsvpReminders) goes to anyone whose session is still over a
  // day away when they save; later savers are too close to the start for it, so don't promise it
  const willRemind = hasStart && start.getTime() - Date.now() > RSVP_REMINDER_PROMISE_MS;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">
              good<span style="color:#000;">*</span>chats
            </div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">you're on the list, ${name}.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">Your spot is saved</p>
            <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>
            <p style="margin:0 0 4px;font-size:15px;color:#333;">${escHtml(whenLine)}</p>
            ${opensLine ? `<p style="margin:0 0 20px;font-size:13px;color:#777;">the room opens at ${escHtml(opensLine)}, 5 minutes before we start.</p>` : '<p style="margin:0 0 20px;"></p>'}
            <a href="${joinUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              See the details + add to calendar →
            </a>
            <p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.5;">
              that link shows the start time in your own timezone. if you open it early you'll see a countdown. the room opens ${opensLine ? 'at ' + escHtml(opensLine) : '5 minutes before we start'}, and the same link lets you in.${willRemind ? ' we\'ll also send you one reminder before it starts.' : ''}
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              You're getting this because you saved your spot at
              <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>.
              This is a one-time confirmation for this session. We Are For Good.
              Don't want these? <a href="${unsub.page}" style="color:#999;">unsubscribe</a>.
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject: `You're in · ${sessionName}`, html, headers: unsubscribeHeaders(unsub) }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[resend] rsvp confirmation failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] rsvp confirmation error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}

// "today" / "tomorrow" / null, judged on the Eastern calendar (like every time we print)
function etDayWord(start, now = new Date()) {
  const day = (d) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }); // YYYY-MM-DD
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  if (day(start) === day(now)) return 'today';
  if (day(start) === day(tomorrow)) return 'tomorrow';
  return null;
}

// sent once to each person who saved a spot, by the daily reminder job, when the session is
// about a day away. same footer rules as every other notify email: unsubscribe link + headers.
export async function sendRsvpReminderEmail({ to, firstName, sessionName, sessionCode, startsAt }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Good Chats <goodchats@weareforgood.com>';
  if (!apiKey) return { ok: false, reason: 'not configured' };
  if (!to) return { ok: false, reason: 'no recipient' };
  const start = startsAt ? new Date(startsAt) : null;
  if (!start || Number.isNaN(start.getTime())) return { ok: false, reason: 'no start time' };
  const unsub = unsubscribeFor(to);
  if (!unsub) return { ok: false, reason: 'unsubscribe not configured' };

  const joinUrl = `https://goodchats.weareforgood.com/r/${encodeURIComponent(sessionCode)}`;
  const timeET = `${start.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
  const opensET = `${new Date(start.getTime() - 5 * 60 * 1000).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })} ET`;
  const dayWord = etDayWord(start);
  const name = firstName ? escHtml(firstName) : 'friend';
  const headline = dayWord ? `${dayWord} at ${timeET}` : formatWhenET(start);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f1;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;background:#fff;border-radius:12px;border:2px solid #000;box-shadow:4px 4px 0 #000;overflow:hidden;">
        <tr>
          <td style="background:#01ecf3;padding:28px 32px;">
            <div style="font-family:Arial Black,sans-serif;font-size:36px;font-weight:900;letter-spacing:-1px;color:#000;">
              good<span style="color:#000;">*</span>chats
            </div>
            <div style="font-size:14px;color:#000;margin-top:4px;opacity:0.7;">see you ${dayWord ? escHtml(dayWord) : 'soon'}, ${name}.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px;">
            <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#888;letter-spacing:.08em;text-transform:uppercase;">A reminder: you saved a spot</p>
            <p style="margin:0 0 6px;font-size:20px;font-weight:700;color:#000;">${escHtml(sessionName)}</p>
            <p style="margin:0 0 4px;font-size:15px;color:#333;">${escHtml(headline)}</p>
            <p style="margin:0 0 20px;font-size:13px;color:#777;">the room opens at ${escHtml(opensET)}, 5 minutes before we start. Same link, nothing to download.</p>
            <a href="${joinUrl}" style="display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;">
              Open the link →
            </a>
            <p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.5;">
              If you open it before the room is open you'll see a countdown. It shows the start time in your own timezone.
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 32px;border-top:1px solid #e5e5e5;">
            <p style="margin:0;font-size:12px;color:#bbb;">
              You're getting this one-time reminder because you saved your spot at
              <a href="https://goodchats.weareforgood.com" style="color:#bbb;">goodchats.weareforgood.com</a>.
              We Are For Good. Can't make it? <a href="${unsub.page}" style="color:#999;">unsubscribe</a>.
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
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: `Reminder: ${sessionName} ${dayWord ? `is ${dayWord} at ${timeET}` : `· ${formatWhenET(start)}`}`,
        html,
        headers: unsubscribeHeaders(unsub),
      }),
    });
    if (!res.ok) {
      const t = await res.text();
      console.error('[resend] rsvp reminder failed', res.status, t);
      return { ok: false, reason: `http ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error('[resend] rsvp reminder error', e?.message || e);
    return { ok: false, reason: 'request failed' };
  }
}
