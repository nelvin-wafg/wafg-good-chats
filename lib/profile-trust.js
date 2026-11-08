// who may act as an EXISTING profile when they type its email into the join form?
//
// the join form is open to everyone, and anyone can type any email. so typing an email proves
// nothing. what does prove it: a cookie this browser got earlier from (a) clicking a one-time
// sign-in link sent to the profile's own inbox, or (b) having joined as that profile before.
// only a caller holding such a cookie for THIS profile may overwrite its saved details,
// subscribe it to the newsletter, or be handed its profile cookie. everyone else still joins
// the session normally, they just can't touch the stored profile.
import { getProfileFromCookies } from './profile-cookie';
import { getSignInFromCookies } from './signin-cookie';

export function isTrustedForProfile(cookieStore, profileId) {
  if (!profileId) return false;
  try {
    const weak = getProfileFromCookies(cookieStore);
    const strong = getSignInFromCookies(cookieStore);
    return weak?.profileId === profileId || strong?.profileId === profileId;
  } catch {
    return false;
  }
}

// the profile this browser can act as, or null. a profile cookie (from joining, or from a
// one-time sign-in link) or the signed-in cookie both count. used by the profile page's own APIs.
export function getTrustedProfileId(cookieStore) {
  try {
    return getProfileFromCookies(cookieStore)?.profileId || getSignInFromCookies(cookieStore)?.profileId || null;
  } catch {
    return null;
  }
}
