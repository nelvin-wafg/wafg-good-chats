// what the host dashboard's "after the call" card shows, and WHETHER to show it.
//
// the card used to render a table of zeros (follow-up and click tracking only exist from
// Nov 2026 on) plus a "recaps" column that was only an estimate. now it stays hidden until there is
// something real to look at:
//   - a session row appears once a follow-up has gone out or a LinkedIn link has been clicked for it
//   - the invites line appears once someone has signed up or joined through an invite link
//     (people merely opening a link, often the host testing it, doesn't count)
export function engagementView(d) {
  const sessions = ((d && d.sessions) || []).filter((s) => (s.followUps || 0) > 0 || (s.linkedinClickers || 0) > 0);
  const inv = (d && d.invites) || { opened: 0, interested: 0, joined: 0 };
  const showInvites = (inv.interested || 0) > 0 || (inv.joined || 0) > 0;
  return { show: sessions.length > 0 || showInvites, sessions, showInvites, invites: inv };
}
