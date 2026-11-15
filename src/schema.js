export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; }
}
const fail = (message) => { throw new ValidationError(message); };
const object = (x, name) => {
  if (!x || typeof x !== 'object' || Array.isArray(x)) fail(`${name} must be an object`);
};
const keys = (x, allowed, name) => {
  object(x, name);
  for (const k of Object.keys(x)) if (!allowed.includes(k)) fail(`${name}: unknown field ${k}`);
};
const text = (x, name, max = 160) => {
  if (typeof x !== 'string' || !x.trim() || x.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x)) fail(`${name} must be nonempty text (max ${max})`);
};
const number = (x, name, min, max) => {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max) fail(`${name} out of range`);
};
const array = (x, name, min, max) => {
  if (!Array.isArray(x) || x.length < min || x.length > max) fail(`${name} requires ${min}–${max} entries`);
};
const timestamp = (x) => {
  number(x, 'timestamp', 0, 8640000000000000);
  if (!Number.isSafeInteger(x)) fail('timestamp must be integer epoch milliseconds');
};

/** Strict telemetry contract. Labels and unrecognized fields are never model inputs. */
export function validateIncident(input) {
  keys(input, ['title', 'services', 'edges', 'baselineEnd', 'metrics', 'logs', 'traces'], 'incident');
  text(input.title, 'title');
  array(input.services, 'services', 2, 32);
  const services = new Set();
  for (const name of input.services) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(name) || services.has(name)) fail('services must be unique lowercase identifiers');
    services.add(name);
  }
  timestamp(input.baselineEnd);
  array(input.edges, 'edges', 0, 128);
  const edges = new Set();
  for (const edge of input.edges) {
    array(edge, 'edge', 2, 2);
    if (!services.has(edge[0]) || !services.has(edge[1]) || edge[0] === edge[1]) fail('edge must connect two distinct known services');
    const id = edge.join('>');
    if (edges.has(id)) fail('duplicate edge');
    edges.add(id);
  }
  // Cycles are allowed: traversal always maintains a visited set.
  array(input.metrics, 'metrics', 20, 10000);
  const groups = new Map(input.services.map(s => [s, []]));
  for (const m of input.metrics) {
    keys(m, ['ts', 'service', 'latencyMs', 'errorRate', 'cpuPct'], 'metric');
    if (!services.has(m.service)) fail('unknown metric service');
    timestamp(m.ts);
    number(m.latencyMs, 'latencyMs', 0, 3600000);
    number(m.errorRate, 'errorRate', 0, 1);
    number(m.cpuPct, 'cpuPct', 0, 100);
    groups.get(m.service).push(m);
  }
  for (const [service, rows] of groups) {
    rows.sort((a, b) => a.ts - b.ts);
    if (new Set(rows.map(m => m.ts)).size !== rows.length) fail(`duplicate metric timestamp for ${service}`);
    if (rows.filter(m => m.ts <= input.baselineEnd).length < 10 || rows.filter(m => m.ts > input.baselineEnd).length < 5) fail(`${service} requires >=10 baseline and >=5 observation samples`);
  }
  const minTs = Math.min(...input.metrics.map(m => m.ts));
  const maxTs = Math.max(...input.metrics.map(m => m.ts));
  if (maxTs - minTs > 7 * 86400000) fail('incident window cannot exceed seven days');
  const ids = new Set();
  for (const [name, max] of [['logs', 2000], ['traces', 4000]]) {
    array(input[name], name, 0, max);
    for (const row of input[name]) {
      keys(row, name === 'logs' ? ['id', 'ts', 'service', 'level', 'message'] : ['id', 'ts', 'caller', 'callee', 'durationMs', 'status'], name);
      text(row.id, 'evidence id', 80);
      if (!/^[\w.-]+$/.test(row.id) || ids.has(row.id)) fail('evidence ids must be unique safe identifiers');
      ids.add(row.id);
      timestamp(row.ts);
      if (row.ts < minTs || row.ts > maxTs) fail('evidence timestamp outside metric window');
      if (name === 'logs') {
        if (!services.has(row.service) || !['info', 'warn', 'error'].includes(row.level)) fail('invalid log service or level');
        text(row.message, 'log message', 1000);
      } else {
        if (!edges.has(`${row.caller}>${row.callee}`)) fail('trace must follow a declared dependency edge');
        number(row.durationMs, 'durationMs', 0, 3600000);
        if (!['ok', 'error'].includes(row.status)) fail('invalid trace status');
      }
    }
  }
  return structuredClone(input);
}

export function redact(text) {
  return text
    .replace(/\b(Bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(password|token|secret|api[_-]?key|authorization)\s*[:=]\s*["']?[^\s,"';]+/gi, '$1=[REDACTED]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]');
}
export function sanitizeIncident(input) {
  const incident = validateIncident(input);
  incident.title = redact(incident.title);
  incident.logs = incident.logs.map(l => ({ ...l, message: redact(l.message) }));
  return incident;
}
