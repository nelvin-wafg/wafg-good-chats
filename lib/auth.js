// Helpers for verifying the caller is an approved host.
// Used in API routes that should be accessible to any approved host (not just
// the session's primary host). Enables co-hosting · Nelvin/Jon/Becky can run
// each other's sessions.

import { createClient, adminClient } from './supabase-server';

// Returns { user, host } if the caller is authenticated AND is_approved=true.
// Returns null otherwise.
export async function getApprovedHost() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const admin = adminClient();
  const { data: host } = await admin
    .from('hosts')
    .select('id, email, display_name, is_approved, is_admin')
    .eq('id', user.id)
    .maybeSingle();
  if (!host?.is_approved) return null;
  return { user, host };
}
