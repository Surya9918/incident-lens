import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeIncident } from '../src/synthetic.js';
import { validateIncident, sanitizeIncident, redact } from '../src/schema.js';
import { extractFeatures, ancestors } from '../src/features.js';
import { analyze } from '../src/analyze.js';
import { validateModel, trainModel, predict } from '../src/model.js';
import { configFromEnv } from '../src/config.js';
const model = validateModel(JSON.parse(readFileSync(new URL('../models/ranker.json', import.meta.url), 'utf8')));
test('valid incident survives strict validation without mutation', () => {
  const { incident } = makeIncident(10001), before = JSON.stringify(incident);
  assert.deepEqual(validateIncident(incident), incident); assert.equal(JSON.stringify(incident), before);
});
test('truth labels and unknown fields cannot leak into inference', () => {
  assert.throws(() => validateIncident({ ...makeIncident(1).incident, rootCause: 'database' }), /unknown field/);
});
test('reject invalid telemetry, duplicate samples and unknown services', () => {
  for (const mutate of [x => { x.metrics[0].latencyMs = NaN; }, x => { x.metrics[0].errorRate = 1.1; }, x => { x.metrics[0].service = 'unknown'; }, x => { x.metrics.push(x.metrics[0]); }, x => { x.services.push(x.services[0]); }, x => { x.edges.push(x.edges[0]); }, x => { x.baselineEnd = 0; }]) {
    const { incident } = makeIncident(1); mutate(incident); assert.throws(() => validateIncident(incident));
  }
});
test('reject missing telemetry and out-of-window or duplicate evidence', () => {
  for (const mutate of [x => { x.logs = undefined; }, x => { x.traces[0].ts = 1; }, x => { x.traces.push(x.traces[0]); }, x => { x.edges = []; }, x => { x.metrics = []; }]) { const { incident } = makeIncident(1); mutate(incident); assert.throws(() => validateIncident(incident)); }
});
test('redaction precedes storage and explanation', () => {
  assert.equal(redact('token=abc password="xyz" a@b.com Bearer abc.def'), 'token=[REDACTED] password=[REDACTED]" [EMAIL] Bearer [REDACTED]');
  const { incident } = makeIncident(1); incident.title = 'token=secret'; incident.logs[0].message = 'api_key=secret'; const sanitized = sanitizeIncident(incident);
  assert(!JSON.stringify(sanitized).includes('=secret')); assert(incident.title.includes('=secret'));
});
test('graph direction and cycles are handled without infinite traversal', () => {
  assert.deepEqual(ancestors('db', [['api', 'db'], ['web', 'api']]).sort(), ['api', 'web']);
  assert.deepEqual(ancestors('a', [['a', 'b'], ['b', 'a']]), ['b']);
});
test('healthy windows abstain', () => {
  for (const seed of [500, 501, 502, 503]) { const result = analyze(makeIncident(seed, { clean: true }).incident, model); assert.equal(result.status, 'no_anomaly'); assert.equal(result.detectedAt, null); }
});
test('one isolated spike cannot trigger sustained detection', () => {
  const { incident } = makeIncident(501, { clean: true });
  const rows = incident.metrics.filter(m => m.service === 'database' && m.ts > incident.baselineEnd); rows[5].latencyMs = 99999;
  assert.equal(analyze(incident, model).status, 'no_anomaly');
});
test('diagnoses contain only real evidence IDs and normalized finite weights', () => {
  const { incident } = makeIncident(10020), result = analyze(incident, model);
  const ids = new Set([...incident.logs, ...incident.traces].map(x => x.id));
  assert(result.candidates.length > 0); assert(Math.abs(result.candidates.reduce((sum, c) => sum + c.rankingWeight, 0) - 1) < 1e-10);
  for (const c of result.candidates) { assert(Number.isFinite(c.rankingWeight)); c.evidenceIds.forEach(id => assert(ids.has(id))); }
  result.evidence.forEach(e => assert(ids.has(e.id)));
});
test('detection timestamp reflects third confirming sample', () => {
  const { incident } = makeIncident(10002), signals = extractFeatures(incident);
  for (const signal of signals.filter(s => s.anomalous)) assert(signal.detectedAt >= signal.onset + 2000);
});
test('model rejects corrupted artifact and feature mismatch', () => {
  assert.throws(() => validateModel({ ...model, weights: [NaN] }));
  assert.throws(() => validateModel({ ...model, featureNames: ['wrong'] }));
});
test('training is deterministic and masked ablation excludes graph', () => {
  const cases = [1, 2, 3, 4].map(seed => { const x = makeIncident(seed); return { records: extractFeatures(x.incident), rootCause: x.truth.rootCause }; });
  const options = { epochs: 5, mask: ['upstreamCoverage'] };
  const a = trainModel(cases, options), b = trainModel(cases, options); assert.deepEqual(a, b); assert.equal(a.weights.at(-1), 0); assert.equal(predict(cases[0].records, a).length, 6);
});
test('production configuration fails closed and local defaults bind loopback', () => {
  assert.equal(configFromEnv({}).host, '127.0.0.1');
  assert.throws(() => configFromEnv({ NODE_ENV: 'production' }), /API_TOKEN/);
  assert.throws(() => configFromEnv({ NODE_ENV: 'production', API_TOKEN: 'x'.repeat(32) }), /APP_ORIGIN/);
  assert.throws(() => configFromEnv({ HOST: '0.0.0.0' }), /requires API_TOKEN/);
  assert.throws(() => configFromEnv({ APP_ORIGIN: 'https://example.com/' }), /exact/);
  assert.throws(() => configFromEnv({ PORT: 'abc' }), /Invalid/);
});
