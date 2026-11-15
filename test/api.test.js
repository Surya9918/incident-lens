import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/server.js';
import { configFromEnv } from '../src/config.js';
import { makeIncident } from '../src/synthetic.js';
import { IncidentStore } from '../src/store.js';
const TOKEN = 'test-only-not-a-production-secret-123456';
async function withServer(fn, extra = {}) {
  const config = configFromEnv({ NODE_ENV: 'production', API_TOKEN: TOKEN, APP_ORIGIN: 'http://localhost:3000', DB_PATH: ':memory:', ...extra });
  const server = createApp(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options = {}) => fetch(url + path, { ...options, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...options.headers } });
  try { await fn(request, url); } finally { await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
}
test('API lifecycle: create, list, fetch, delete, not found', async () => withServer(async request => {
  const incident = makeIncident(1001).incident;
  let response = await request('/api/incidents', { method: 'POST', body: JSON.stringify(incident) }); assert.equal(response.status, 201);
  const created = await response.json(); assert(created.id); assert(created.result.candidates.length);
  const list = await request('/api/incidents').then(r => r.json()); assert.equal(list.incidents[0].id, created.id);
  assert.equal((await request(`/api/incidents/${created.id}`)).status, 200);
  assert.equal((await request(`/api/incidents/${created.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await request(`/api/incidents/${created.id}`)).status, 404);
}));
test('authentication, origin and production demo restrictions', async () => withServer(async request => {
  assert.equal((await request('/api/info', { headers: { Authorization: '' } })).status, 401);
  assert.equal((await request('/api/info', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal((await request('/api/info', { headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await request('/api/demo', { method: 'POST', body: '{"seed":1}' })).status, 404);
  assert.equal((await request('/health/ready', { headers: { Authorization: '' } })).status, 200);
}));
test('bad JSON, schemas, content types, body size and pagination are rejected', async () => withServer(async request => {
  assert.equal((await request('/api/incidents', { method: 'POST', body: '{' })).status, 400);
  assert.equal((await request('/api/incidents', { method: 'POST', body: '{}' })).status, 422);
  assert.equal((await request('/api/incidents', { method: 'POST', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request('/api/incidents', { method: 'POST', body: 'x'.repeat(2 * 1024 * 1024 + 1) })).status, 413);
  assert.equal((await request('/api/incidents?limit=-1')).status, 422);
}));
test('static files are allowlisted and protected by CSP', async () => withServer(async request => {
  const page = await request('/'); assert.equal(page.status, 200); assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await request('/models/ranker.json')).status, 404);
  assert.equal((await request('/%2e%2e/.env')).status, 404);
  assert.equal((await request('/src/server.js')).status, 404);
}));
test('rate limits return retry guidance', async () => withServer(async request => {
  assert.equal((await request('/api/info')).status, 200);
  assert.equal((await request('/api/info')).status, 200);
  const limited = await request('/api/info'); assert.equal(limited.status, 429); assert(limited.headers.has('retry-after'));
}, { RATE_LIMIT: '2' }));
test('demo labels stay outside model inputs', async () => withServer(async request => {
  const response = await request('/api/demo', { method: 'POST', body: '{"seed":10020}' }); assert.equal(response.status, 201);
  const data = await response.json(); assert(data.demoTruth.rootCause); assert(!('truth' in data.incident)); assert(!('rootCause' in data.incident));
}, { DEMO_ENABLED: 'true' }));
test('persistence survives reopening, retention and count are enforced', () => {
  const dir = mkdtempSync(join(tmpdir(), 'incident-lens-test-')), path = join(dir, 'db.sqlite');
  try {
    let store = new IncidentStore(path, { maxIncidents: 2 }); const incident = makeIncident(1).incident;
    store.create(incident, { status: 'diagnosed' }); store.create(incident, { status: 'diagnosed' }); store.create(incident, { status: 'diagnosed' }); assert.equal(store.list().length, 2); const id = store.list()[0].id; store.close();
    store = new IncidentStore(path); assert.equal(store.get(id).incident.title, incident.title);
    store.db.prepare('UPDATE incidents SET created_at = ?').run(0); assert.equal(store.list().length, 0); store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
