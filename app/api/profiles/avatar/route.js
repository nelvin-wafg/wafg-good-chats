import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { adminClient } from '@/lib/supabase-server';
import { getProfileFromCookies } from '@/lib/profile-cookie';
import { rateLimitByIp } from '@/lib/rate-limit';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB · matches the storage bucket's file_size_limit
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

// POST /api/profiles/avatar  · multipart/form-data, field name "file"
// self-upload only · identified by the 6-month profile cookie, same identity
// used for /api/profiles/me. no moderation queue (trust-based, small
// community) — just type/size checks server-side regardless of what the
// browser claims.
export async function POST(request) {
  const allowed = await rateLimitByIp(request, 'profiles-avatar', { limit: 10, windowSeconds: 300 });
  if (!allowed) return new NextResponse('too many requests', { status: 429 });

  const me = getProfileFromCookies(cookies());
  if (!me?.profileId) return new NextResponse('unauthorized', { status: 401 });

  let file;
  try {
    const form = await request.formData();
    file = form.get('file');
  } catch {
    return new NextResponse('bad request', { status: 400 });
  }
  if (!file || typeof file === 'string') {
    return new NextResponse('file required', { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return new NextResponse('only jpeg, png, or webp images are allowed', { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return new NextResponse('image must be 5MB or smaller', { status: 400 });
  }

  const admin = adminClient();
  const { data: profile } = await admin.from('profiles').select('id').eq('id', me.profileId).maybeSingle();
  if (!profile) return new NextResponse('profile not found', { status: 404 });

  const path = `${profile.id}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error: uploadErr } = await admin.storage
    .from('avatars')
    .upload(path, buffer, { contentType: file.type, upsert: true });
  if (uploadErr) {
    console.error('[avatar] upload failed', uploadErr);
    return new NextResponse('upload failed', { status: 500 });
  }

  const { data: pub } = admin.storage.from('avatars').getPublicUrl(path);
  // cache-bust so a re-upload with the same extension shows immediately
  // instead of a stale cached image at the same URL.
  const avatarUrl = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: updateErr } = await admin
    .from('profiles')
    .update({ avatar_url: avatarUrl, updated_at: new Date().toISOString() })
    .eq('id', profile.id);
  if (updateErr) {
    console.error('[avatar] profile update failed', updateErr);
    return new NextResponse('could not save avatar', { status: 500 });
  }

  return NextResponse.json({ avatarUrl });
}
