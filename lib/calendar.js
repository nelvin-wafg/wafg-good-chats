// "add to calendar" for a Good Chats session: a Google Calendar link and an .ics file. same event
// the "coming up" page offers (title, start, a block of rounds + ~10 minutes, the join link).
const fmt = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (t) => String(t).replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

function eventFor({ name, code, startsAt, durationMin, origin }) {
  const start = new Date(startsAt);
  if (!startsAt || Number.isNaN(start.getTime())) return null;
  const end = new Date(start.getTime() + Math.max(30, durationMin || 0) * 60 * 1000);
  const joinUrl = `${origin}/r/${code}`;
  const details = `Seven-minute conversations, on purpose.\nJoin here: ${joinUrl}\nThe room opens 5 minutes before the start.`;
  return { start, end, joinUrl, details, name, code };
}

export function googleCalendarUrl(input) {
  const ev = eventFor(input);
  if (!ev) return null;
  return (
    'https://calendar.google.com/calendar/render?action=TEMPLATE' +
    `&text=${encodeURIComponent(ev.name)}` +
    `&dates=${fmt(ev.start)}/${fmt(ev.end)}` +
    `&details=${encodeURIComponent(ev.details)}` +
    `&location=${encodeURIComponent(ev.joinUrl)}`
  );
}

export function buildIcs(input) {
  const ev = eventFor(input);
  if (!ev) return null;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//We Are For Good//Good Chats//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${ev.code}-${ev.start.getTime()}@goodchats.weareforgood.com`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(ev.start)}`,
    `DTEND:${fmt(ev.end)}`,
    `SUMMARY:${esc(ev.name)}`,
    `DESCRIPTION:${esc(ev.details)}`,
    `URL:${ev.joinUrl}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT10M',
    'ACTION:DISPLAY',
    'DESCRIPTION:good chats starts soon',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}
