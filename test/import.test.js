import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, importMetricsCsv } from '../src/import-csv.js';
test('CSV supports quoted commas, quotes, CRLF and embedded newlines', () => {
  assert.deepEqual(parseCsv('a,b\r\n"hello, world","a""b"\r\n"two\nlines",ok'), [{ a: 'hello, world', b: 'a"b' }, { a: 'two\nlines', b: 'ok' }]);
});
test('malformed CSV is rejected', () => {
  for (const text of ['a,a\n1,2', 'a,b\n1', 'a,b\n"x,y', 'a,b\n"x"z,y']) assert.throws(() => parseCsv(text));
});
test('explicit metrics mapping converts units without importing labels', () => {
  const csv = 'time,api_latency,db_latency,error,cpu,root_cause\n' + Array.from({ length: 20 }, (_, i) => `${i + 1},0.01,0.02,0,0.2,database`).join('\n');
  const mapping = { title: 'Mapped dataset', timestamp: { column: 'time', scale: 1000 }, baselineEnd: 10000, edges: [['api', 'database']], services: ['api', 'database'].map((name, i) => ({ name, latencyMs: { column: i ? 'db_latency' : 'api_latency', scale: 1000 }, errorRate: { column: 'error' }, cpuPct: { column: 'cpu', scale: 100 } })) };
  const incident = importMetricsCsv(csv, mapping);
  assert.equal(incident.metrics.length, 40); assert.equal(incident.metrics[0].latencyMs, 10); assert.equal(incident.metrics[0].cpuPct, 20); assert(!('root_cause' in incident));
  mapping.services[0].latencyMs.column = 'missing'; assert.throws(() => importMetricsCsv(csv, mapping));
});
