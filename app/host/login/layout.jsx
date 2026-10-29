// the host sign-in page is a working door for the team, not something the public or search engines
// need to find: keep it out of search results. (hosts reach it at /host, which sends anyone who
// isn't signed in here.)
export const metadata = {
  title: 'Host sign in · Good Chats',
  robots: { index: false, follow: false },
};

export default function HostLoginLayout({ children }) {
  return children;
}
