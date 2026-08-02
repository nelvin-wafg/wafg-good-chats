import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { verifyEmailVerifyToken } from '@/lib/email-verify-token';
import { addSubscriberToKit } from '@/lib/kit';

// GET /api/profiles/verify?token=...
// clicked from the "confirm your email" link sent to brand-new joiners.
// marks the profile's email as verified · this is what unlocks recap emails
// and the deferred kit newsletter sync for that profile going forward.
export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token');
  const verified = verifyEmailVerifyToken(token);

  const page = (title, message) => new NextResponse(
    `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} · Good Chats</title></head>
    <body style="margin:0;padding:0;background:#f4f4f1;font-family:Inter,Arial,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;">
      <div style="max-width:420px;padding:32px;text-align:center;">
        <div style="font-family:Arial Black,sans-serif;font-size:32px;font-weight:900;letter-spacing:-1px;color:#000;margin-bottom:16px;">good<span>*</span>chats</div>
        <p style="font-size:16px;color:#333;line-height:1.5;">${message}</p>
      </div>
    </body></html>`,
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );

  if (!verified) {
    return page('link expired', "[this verification link is invalid or has expired. no worries — it doesn't affect your spot in any session you've already joined.]");
  }

  const admin = adminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('id, email, display_name, linkedin_url, newsletter_opt_in, kit_synced_at, email_verified_at')
    .eq('id', verified.profileId)
    .maybeSingle();

  if (!profile || profile.email !== verified.email) {
    return page('link expired', "[this verification link is invalid or has expired. no worries — it doesn't affect your spot in any session you've already joined.]");
  }

  if (!profile.email_verified_at) {
    await admin
      .from('profiles')
      .update({ email_verified_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  // the newsletter sync was deferred at join time for brand-new profiles until
  // this moment, so a stranger's inbox never gets subscribed without them
  // actually confirming they own it.
  if (profile.newsletter_opt_in && !profile.kit_synced_at) {
    addSubscriberToKit({
      email: profile.email,
      firstName: (profile.display_name || '').split(' ')[0],
      linkedinUrl: profile.linkedin_url,
    })
      .then(async (r) => {
        if (r.ok) {
          await admin.from('profiles').update({ kit_synced_at: new Date().toISOString() }).eq('id', profile.id);
        }
      })
      .catch(() => {});
  }

  return page('you\'re verified', "you're all set. we'll send your session recap here, and if you opted in, the WAFG newsletter too.");
}
