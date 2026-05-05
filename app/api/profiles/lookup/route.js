import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase-server';
import { validateEmail, ValidationError } from '@/lib/validate';
import { rateLimitByIp } from '@/lib/rate-limit';

// POST /api/profiles/lookup  body: { email }
// returns { found: bool, profile?: { display_name, linkedin_url, newsletter_opt_in } }
// used by the join form to autofill returning users without exposing profile_id.
export async function POST(request) {
  // rate-limit to discourage email enumeration
  const ok = await rateLimitByIp(request, 'profile-lookup', { limit: 30, windowSeconds: 300 });
  if (!ok) return new NextResponse('too many lookups', { status: 429 });

  let email;
  try {
    const body = await request.json();
    email = validateEmail(body?.email);
  } catch (err) {
    if (err instanceof ValidationError) return new NextResponse(err.message, { status: 400 });
    return new NextResponse('bad request', { status: 400 });
  }

  const admin = adminClient();
  const { data } = await admin
    .from('profiles')
    .select('display_name, linkedin_url, newsletter_opt_in')
    .eq('email', email)
    .maybeSingle();

  if (!data) return NextResponse.json({ found: false });
  return NextResponse.json({
    found: true,
    profile: {
      display_name: data.display_name,
      linkedin_url: data.linkedin_url,
      newsletter_opt_in: data.newsletter_opt_in,
    },
  });
}
