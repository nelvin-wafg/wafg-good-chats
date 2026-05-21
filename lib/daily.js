// daily.co API helpers. server-side only (uses DAILY_API_KEY).
const DAILY_BASE = 'https://api.daily.co/v1';

function authHeaders() {
  return {
    'Authorization': `Bearer ${process.env.DAILY_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

// create a daily room. returns { name, url, ... }
export async function createRoom({ name, expMinutes = 90, isMain = false }) {
  const exp = Math.floor(Date.now() / 1000) + expMinutes * 60;
  const res = await fetch(`${DAILY_BASE}/rooms`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      name,
      privacy: 'public',
      properties: {
        exp,
        max_participants: isMain ? 30 : 4,
        enable_chat: true,
        enable_screenshare: isMain,
        enable_knocking: false,
        enable_prejoin_ui: false,
        start_video_off: false,
        start_audio_off: false,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`daily createRoom failed: ${res.status} ${t}`);
  }
  return res.json();
}

// generate meeting token for a participant. lets them join a specific room with a name.
// userId (optional) sets daily's user_id, a stable unique identifier we use to match
// daily participants to our DB participants (names can collide, ids can't).
export async function createMeetingToken({ roomName, userName, userId, isOwner = false, expMinutes = 30 }) {
  const exp = Math.floor(Date.now() / 1000) + expMinutes * 60;
  const res = await fetch(`${DAILY_BASE}/meeting-tokens`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      properties: {
        room_name: roomName,
        user_name: userName,
        ...(userId ? { user_id: userId } : {}),
        is_owner: isOwner,
        exp,
      },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`daily createMeetingToken failed: ${res.status} ${t}`);
  }
  const data = await res.json();
  return data.token;
}

// destroy a room (called when round ends to free up resources)
export async function deleteRoom(name) {
  const res = await fetch(`${DAILY_BASE}/rooms/${name}`, {
    method: 'DELETE',
    headers: authHeaders(),
  });
  // 404 is fine (already gone)
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(`daily deleteRoom failed: ${res.status} ${t}`);
  }
  return true;
}

// build an externally-shareable URL from a room name (no token, just for debugging)
export function roomUrl(name) {
  const domain = process.env.DAILY_DOMAIN || 'wafg';
  return `https://${domain}.daily.co/${name}`;
}
