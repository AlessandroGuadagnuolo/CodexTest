import crypto from 'node:crypto';

function escapeText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

function formatUtc(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? match[1] + match[2] + match[3] : '';
}

function stableUid(item) {
  const value = [item.provider, item.accountId, item.calendarId, item.id].join('|');
  return crypto.createHash('sha256').update(value).digest('hex') + '@codexcalendar.local';
}

function foldLine(line) {
  const output = [];
  let current = '';
  let bytes = 0;
  for (const character of line) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (bytes + characterBytes > 75 && current) {
      output.push(current);
      current = ' ';
      bytes = 1;
    }
    current += character;
    bytes += characterBytes;
  }
  output.push(current);
  return output.join('\r\n');
}

function eventLines(item, timestamp) {
  const start = item.allDay ? formatDate(item.start) : formatUtc(item.start);
  const end = item.allDay ? formatDate(item.end) : formatUtc(item.end);
  if (!start || !end) return [];
  const lines = [
    'BEGIN:VEVENT',
    'UID:' + stableUid(item),
    'DTSTAMP:' + timestamp,
    item.allDay ? 'DTSTART;VALUE=DATE:' + start : 'DTSTART:' + start,
    item.allDay ? 'DTEND;VALUE=DATE:' + end : 'DTEND:' + end,
    'SUMMARY:' + escapeText(item.title || '(Senza titolo)')
  ];
  if (item.description) lines.push('DESCRIPTION:' + escapeText(item.description));
  if (item.location) lines.push('LOCATION:' + escapeText(item.location));
  if (item.url && /^https:\/\//i.test(item.url)) lines.push('URL:' + item.url.replace(/[\r\n]/g, ''));
  if (item.isTask) lines.push('CATEGORIES:Google Tasks');
  lines.push('END:VEVENT');
  return lines;
}

export function buildICalendar(items) {
  const timestamp = formatUtc(new Date().toISOString());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CodexTest//Calendario Unificato//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Calendario Unificato'
  ];
  for (const item of items || []) lines.push(...eventLines(item, timestamp));
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
