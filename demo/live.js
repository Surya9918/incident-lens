import { startService } from './service.js';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { sanitizeIncident } from '../src/schema.js';
import { analyze } from '../src/analyze.js';
import { validateModel } from '../src/model.js';

// Six real loopback HTTP servers; one process, deliberately no claim of distributed deployment.
const running = [];
try {
  const create = async (name, dependencies = []) => { const service = await startService(name, dependencies); running.push(service); return service; };
  const database = await create('database'), cache = await create('cache');
  const payments = await create('payments', [database]), inventory = await create('inventory', [database, cache]);
  const checkout = await create('checkout', [payments, inventory]), gateway = await create('gateway', [checkout]);
  const edges = [['gateway', 'checkout'], ['checkout', 'payments'], ['checkout', 'inventory'], ['payments', 'database'], ['inventory', 'database'], ['inventory', 'cache']];
  const metrics = [], previous = new Map(); let baselineEnd;
  console.log('Collecting healthy telemetry from six loopback HTTP services…');
  for (let tick = 0; tick < 35; tick++) {
    if (tick === 22) { await fetch(`${database.url}/fault`, { method: 'POST' }); console.log('Injected database failure. Collecting propagated symptoms…'); }
    await Promise.all(Array.from({ length: 3 }, () => fetch(`${gateway.url}/request`).then(r => r.arrayBuffer())));
    const timestamp = Date.now();
    if (tick === 19) baselineEnd = timestamp;
    for (const service of running) {
      const value = await fetch(`${service.url}/telemetry`).then(r => r.json());
      const prev = previous.get(service.name) || { requests: 0, failures: 0, durationTotal: 0 };
      const count = value.requests - prev.requests;
      metrics.push({ ts: timestamp, service: service.name, latencyMs: count ? (value.durationTotal - prev.durationTotal) / count : 0, errorRate: count ? (value.failures - prev.failures) / count : 0, cpuPct: 0 });
      previous.set(service.name, value);
    }
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  const min = Math.min(...metrics.map(m => m.ts)), max = Math.max(...metrics.map(m => m.ts));
  const inWindow = r => r.ts >= min && r.ts <= max;
  const incident = sanitizeIncident({ title: 'Live HTTP demo · database fault', services: running.map(s => s.name), edges, baselineEnd, metrics, logs: [...previous.values()].flatMap(v => v.logs).filter(inWindow), traces: [...previous.values()].flatMap(v => v.traces).filter(inWindow) });
  const model = validateModel(JSON.parse(readFileSync('models/ranker.json', 'utf8')));
  const result = analyze(incident, model);
  mkdirSync('data', { recursive: true });
  writeFileSync('data/live-incident.json', JSON.stringify(incident, null, 2));
  writeFileSync('data/live-report.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ expectedRoot: 'database', leadingHypothesis: result.candidates[0]?.service, status: result.status, telemetry: 'data/live-incident.json', report: 'data/live-report.json', limitation: 'Single-process loopback HTTP demo; CPU is not collected (zero sentinel).' }, null, 2));
  if (process.argv.includes('--check') && result.candidates[0]?.service !== 'database') throw new Error('Live demo did not rank the injected database fault first');
} finally {
  await Promise.all(running.map(s => new Promise(resolve => { s.server.close(resolve); s.server.closeAllConnections(); })));
}
