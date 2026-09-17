import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// only a root-relative, single-slash path is a valid post-login destination ·
// anything else (a scheme, a protocol-relative "//evil.com", or unparseable
// input) falls back to /host. without this, `next` is attacker-controlled and
// `new URL(next, url.origin)` will happily honor a fully-qualified external URL,
// turning this trusted-domain endpoint into an open redirect for phishing.
function safeNextPath(next) {
  if (typeof next === 'string' && /^\/(?!\/)[a-zA-Z0-9\-_/]*$/.test(next)) return next;
  return '/host';
}

// magic link callback: supabase redirects here after the user clicks the email link.
// we exchange the code in the URL for a session, then redirect to /host.
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = safeNextPath(url.searchParams.get('next'));

  if (code) {
    const supabase = createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, url.origin));
}
