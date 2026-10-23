import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// authenticated supabase client for server components / route handlers.
// uses cookies for session.
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            toSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a server component — ok to ignore, middleware handles refresh
          }
        },
      },
    }
  );
}

// service-role client for privileged ops (creating rooms, broadcasting state).
// NEVER expose this to the browser.
import { createClient as createSbClient } from '@supabase/supabase-js';

// next.js caches fetch() responses on the server by default, and supabase-js reads the
// database over fetch. a route that doesn't touch cookies (like /api/landing) would
// therefore be served the SAME database answer forever: once it saw "no published
// session" it kept saying so after one was published, which is why the homepage's
// "next session" disappeared. this app's data changes constantly (sessions go live,
// people join, hosts reschedule), so database reads must never be cached.
const noStoreFetch = (input, init = {}) => fetch(input, { ...init, cache: 'no-store' });

export function adminClient() {
  return createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: noStoreFetch },
    }
  );
}
