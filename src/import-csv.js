import { validateIncident } from './schema.js';
/** RFC 4180-style CSV parser: quoted fields, doubled quotes and embedded newlines. */
export function parseCsv(text) {
  const rows = []; let row = [], field = '', quoted = false, closed = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') { quoted = false; closed = true; } else field += c; continue; }
    if (c === '"') { if (field || closed) throw new Error('Invalid CSV quote'); quoted = true; }
    else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field); field = ''; closed = false;
      if (c !== ',') { if (row.some(x => x !== '')) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
    } else { if (closed) throw new Error('Unexpected text after quoted field'); field += c; }
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (field || closed || row.length) { row.push(field); rows.push(row); }
  if (rows.length < 2 || new Set(rows[0]).size !== rows[0].length || rows[0].some(x => !x) || rows.some(r => r.length !== rows[0].length)) throw new Error('CSV requires unique headers and consistent nonempty rows');
  return rows.slice(1).map(r => Object.fromEntries(rows[0].map((h, i) => [h, r[i]])));
}
export function importMetricsCsv(text, mapping) {
  const rows = parseCsv(text);
  const value = (row, field) => {
    if (!field || typeof field.column !== 'string' || !Object.hasOwn(row, field.column) || row[field.column].trim() === '') throw new Error('Mapped column missing or empty');
    const scale = field.scale ?? 1, offset = field.offset ?? 0;
    if (![scale, offset].every(Number.isFinite)) throw new Error('Scale and offset must be finite');
    const n = Number(row[field.column]); if (!Number.isFinite(n)) throw new Error(`Nonnumeric ${field.column}`);
    return n * scale + offset;
  };
  const metrics = rows.flatMap(row => mapping.services.map(s => ({ service: s.name, ts: value(row, mapping.timestamp), latencyMs: value(row, s.latencyMs), errorRate: value(row, s.errorRate), cpuPct: value(row, s.cpuPct) })));
  return validateIncident({ title: mapping.title, services: mapping.services.map(s => s.name), edges: mapping.edges, baselineEnd: mapping.baselineEnd, metrics, logs: [], traces: [] });
}
