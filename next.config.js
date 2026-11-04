// response headers.
//
// everywhere: stop browsers guessing file types, don't leak full URLs (unsubscribe / verify
// links carry tokens in the query string) to other sites, and switch off browser features this
// app never uses. camera and microphone are deliberately NOT listed: video calls need them and
// the call library may delegate them to its own frame, so restricting them could break a live
// event.
//
// host pages and the unsubscribe page also refuse to be shown inside someone else's page, so a
// hostile site can't overlay invisible buttons on the dashboard (clickjacking). the public join
// pages are left frameable on purpose, in case they are embedded on weareforgood.com.
//
// the Content-Security-Policy is REPORT-ONLY: it blocks nothing, it only logs violations to the
// browser console (open dev tools on a page) so it can be tightened without risking a break.
// when the console stays clean through a real event, switch the header name to
// 'Content-Security-Policy' to enforce it.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.daily.co",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.daily.co wss://*.daily.co https://*.wss.daily.co https://*.pluot.blue wss://*.pluot.blue",
  "frame-src https://*.daily.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const baseHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'geolocation=(), payment=(), usb=(), interest-cohort=()' },
  { key: 'Content-Security-Policy-Report-Only', value: csp },
];

const noFraming = [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // the app never uses next/image, so switch off Next's built-in image optimizer (/_next/image)
  // rather than leave an unused endpoint exposed: several published Next.js advisories are
  // about that optimizer.
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      { source: '/:path*', headers: baseHeaders },
      { source: '/host/:path*', headers: noFraming },
      { source: '/unsubscribe', headers: noFraming },
    ];
  },
};

module.exports = nextConfig;
