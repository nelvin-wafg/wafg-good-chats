// simple sliding-window rate limiter backed by supabase.
// good enough for casual abuse prevention. for serious DDoS, use a real
// rate-limiting service (upstash, cloudflare).

import { adminClient } from './supabase-server';

// extract a client IP from request headers. returns 'unknown' if not available.
export function getClientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const real = request.headers.get('x-real-ip');
  if (real) return real.trim();
  return 'unknown';
}

// returns { ok: boolean, remaining: number }
// records the request, then checks if we're under the threshold.
export async function checkRateLimit(bucket, limit, windowSeconds) {
  const admin = adminClient();
  // record this request
  const { error: insertErr } = await admin
    .from('rate_limits')
    .insert({ bucket });
  if (insertErr) {
    // if we can't insert, fail open (don't block legit requests due to db hiccups)
    console.error('rate-limit insert failed', insertErr);
    return { ok: true, remaining: limit };
  }

  // count requests in the window
  const { data, error } = await admin.rpc('count_rate_limit', {
    p_bucket: bucket,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    console.error('rate-limit count failed', error);
    return { ok: true, remaining: limit };
  }

  const count = data || 0;
  return { ok: count <= limit, remaining: Math.max(0, limit - count) };
}

// convenience: rate-limit by IP for a given action.
// returns true if allowed, false if blocked.
export async function rateLimitByIp(request, action, { limit, windowSeconds }) {
  const ip = getClientIp(request);
  const bucket = `${action}:${ip}`;
  const { ok } = await checkRateLimit(bucket, limit, windowSeconds);
  return ok;
}
