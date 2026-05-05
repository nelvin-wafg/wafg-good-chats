import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getProfileFromCookies } from '@/lib/profile-cookie';
import JoinForm from './JoinForm';

export default async function JoinPage({ params }) {
  const supabase = adminClient();
  const { data: session } = await supabase
    .from('sessions')
    .select('id, code, name, status, rounds_total, round_seconds')
    .eq('code', params.code)
    .single();

  if (!session) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8" style={{ background: '#f4f4f1' }}>
        <div className="max-w-md text-center">
          <div className="display text-5xl mb-4">we don't<br/>see this one.</div>
          <p className="text-neutral-600 mb-6">
            [the code doesn't match an event we know about. ask whoever sent you the link to double-check.]
          </p>
          <a href="/" className="text-sm underline">back home</a>
        </div>
      </main>
    );
  }

  // returning user · check the persistent profile cookie
  let knownProfile = null;
  const cookieStore = cookies();
  const cookieData = getProfileFromCookies(cookieStore);
  if (cookieData?.profileId) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, email, linkedin_url, newsletter_opt_in')
      .eq('id', cookieData.profileId)
      .maybeSingle();
    if (profile) {
      knownProfile = {
        displayName: profile.display_name,
        email: profile.email,
        linkedinUrl: profile.linkedin_url,
        newsletterOptIn: profile.newsletter_opt_in,
      };
    }
  }

  return <JoinForm session={session} knownProfile={knownProfile} />;
}
