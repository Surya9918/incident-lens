import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { configFromEnv } from './config.js';
import { IncidentStore } from './store.js';
import { sanitizeIncident, ValidationError } from './schema.js';
import { analyze } from './analyze.js';
import { validateModel } from './model.js';
import { makeIncident } from './synthetic.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const digest = s => createHash('sha256').update(s).digest();
const validId = id => /^[a-f0-9-]{36}$/.test(id);
async function readBody(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw Object.assign(new Error('Content-Type must be application/json'), { status: 415 });
  const max = 2 * 1024 * 1024;
  if (Number(req.headers['content-length']) > max) { req.resume(); throw Object.assign(new Error('Payload too large'), { status: 413 }); }
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('Invalid JSON'), { status: 400 }); }
}

export function createApp(config, { store, model } = {}) {
  store ??= new IncidentStore(config.dbPath, config);
  model ??= validateModel(JSON.parse(readFileSync(resolve(root, 'models/ranker.json'), 'utf8')));
  const assets = new Map([['/', ['public/index.html', 'text/html']], ['/app.js', ['public/app.js', 'text/javascript']], ['/style.css', ['public/style.css', 'text/css']]].map(([url, [path, type]]) => [url, { body: readFileSync(resolve(root, path)), type }]));
  const limits = new Map(); const counters = { requests: 0, errors: 0, analyzed: 0 };
  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID(); counters.requests++;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://local');
      if (req.method === 'GET' && url.pathname === '/health/live') return send(200, { status: 'ok' });
      if (req.method === 'GET' && url.pathname === '/health/ready') { store.db.prepare('SELECT 1').get(); return send(200, { status: 'ready', model: model.id }); }
      if (req.method === 'GET' && assets.has(url.pathname)) { const asset = assets.get(url.pathname); res.writeHead(200, { 'Content-Type': `${asset.type}; charset=utf-8` }); return res.end(asset.body); }
      if (!url.pathname.startsWith('/api/')) return send(404, { error: 'Not found', requestId });
      const now = Date.now(), ip = req.socket.remoteAddress;
      if (limits.size >= 10000) for (const [key, value] of limits) if (value.reset <= now) limits.delete(key);
      let bucket = limits.get(ip);
      if (!bucket || bucket.reset <= now) { if (!bucket && limits.size >= 10000) return send(503, { error: 'Busy; retry later', requestId }); bucket = { count: 0, reset: now + 60000 }; limits.set(ip, bucket); }
      if (++bucket.count > config.rateLimit) { res.setHeader('Retry-After', String(Math.ceil((bucket.reset - now) / 1000))); return send(429, { error: 'Rate limit exceeded', requestId }); }
      // A browser may not send Origin on GET. Reject foreign Origin whenever supplied.
      const expectedOrigin = config.origin || `http://${req.headers.host}`;
      if (req.headers.origin && req.headers.origin !== expectedOrigin) return send(403, { error: 'Origin rejected', requestId });
      // Prevent DNS rebinding in unauthenticated localhost development mode.
      if (!config.token && !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(`http://${req.headers.host}`).hostname)) return send(403, { error: 'Host rejected', requestId });
      if (config.token && !timingSafeEqual(digest(req.headers.authorization || ''), digest(`Bearer ${config.token}`))) return send(401, { error: 'Authentication required', requestId });
      if (req.method === 'GET' && url.pathname === '/api/info') return send(200, { name: 'IncidentLens', version: '1.0.0', model: model.id, demoEnabled: config.demoEnabled, retentionDays: config.retentionDays });
      if (req.method === 'GET' && url.pathname === '/api/metrics') { res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' }); return res.end(Object.entries(counters).map(([k, v]) => `incident_lens_${k}_total ${v}`).join('\n') + '\n'); }
      if (req.method === 'GET' && url.pathname === '/api/incidents') {
        const limit = Number(url.searchParams.get('limit') ?? 30), offset = Number(url.searchParams.get('offset') ?? 0);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new ValidationError('Invalid pagination');
        return send(200, { incidents: store.list(limit, offset) });
      }
      if (req.method === 'POST' && url.pathname === '/api/incidents') {
        const incident = sanitizeIncident(await readBody(req));
        const result = analyze(incident, model); counters.analyzed++;
        return send(201, store.create(incident, result));
      }
      if (req.method === 'POST' && url.pathname === '/api/demo') {
        if (!config.demoEnabled) return send(404, { error: 'Not found', requestId });
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['seed', 'clean'].includes(k)) || !Number.isInteger(body.seed) || body.seed < 1 || body.seed > 1000000 || (body.clean !== undefined && typeof body.clean !== 'boolean')) throw new ValidationError('Expected seed (1..1000000) and optional clean boolean');
        const { incident, truth } = makeIncident(body.seed, { clean: body.clean });
        const safe = sanitizeIncident(incident), result = analyze(safe, model); counters.analyzed++;
        return send(201, { ...store.create(safe, result), demoTruth: truth });
      }
      const match = url.pathname.match(/^\/api\/incidents\/([^/]+)$/);
      if (match && validId(match[1])) {
        if (req.method === 'GET') { const item = store.get(match[1]); return send(item ? 200 : 404, item || { error: 'Not found', requestId }); }
        if (req.method === 'DELETE') return send(store.delete(match[1]) ? 200 : 404, { requestId });
      }
      return send(404, { error: 'Not found', requestId });
    } catch (error) {
      counters.errors++;
      const status = error instanceof ValidationError ? 422 : (error.status || 500);
      if (status === 500) console.error(JSON.stringify({ level: 'error', event: 'request_failed', requestId, type: error.name }));
      if (!res.headersSent && !res.destroyed) send(status, { error: status === 500 ? 'Internal server error' : error.message, requestId });
    }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  server.on('close', () => store.close());
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = configFromEnv(), server = createApp(config);
    server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'listening', host: config.host, port: server.address().port, auth: Boolean(config.token), demo: config.demoEnabled })));
    server.on('error', err => { console.error(JSON.stringify({ event: 'server_error', code: err.code })); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(() => { process.exitCode = 0; }); server.closeIdleConnections(); setTimeout(() => process.exit(1), 10000).unref(); });
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}
