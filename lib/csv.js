// minimal CSV serializer · escapes quotes and commas safely, and defuses spreadsheet formulas.

// excel / google sheets / numbers run a cell as a formula when its text starts with = + - @
// (or a tab / carriage return). names, emails and links in our exports are typed by strangers,
// so a signup called  =HYPERLINK("http://evil",  "click me")  would become a live formula in
// the host's spreadsheet. a leading apostrophe makes the cell plain text (it is not shown).
// real numbers are left alone: only text is touched.
const FORMULA_START = /^[=+\-@\t\r]/;

function escapeCell(value) {
  if (value == null) return '';
  let s = String(value);
  if (typeof value === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// rows: array of objects · headers: array of column keys (matching object keys)
// returns a CSV string with headers row.
export function toCSV(rows, headers) {
  if (!Array.isArray(rows)) rows = [];
  if (!Array.isArray(headers) || headers.length === 0) {
    if (rows.length > 0) headers = Object.keys(rows[0]);
    else headers = [];
  }
  const headerRow = headers.map(escapeCell).join(',');
  const dataRows = rows.map((r) => headers.map((h) => escapeCell(r[h])).join(','));
  return [headerRow, ...dataRows].join('\r\n');
}

// build a Response with proper headers for browser download
export function csvResponse(csv, filename) {
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
