// minimal CSV serializer · escapes quotes and commas safely.

function escapeCell(value) {
  if (value == null) return '';
  const s = String(value);
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
