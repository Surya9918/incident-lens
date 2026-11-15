/** Local fault-injection fixture. Not part of the production server. */
import http from 'node:http';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
export async function startService(name, dependencies = []) {
  let fault = false, sequence = 0, requests = 0, failures = 0, durationTotal = 0;
  const logs = [], traces = [];
  const record = (array, item) => { array.push(item); if (array.length > 2000) array.shift(); };
  const server = http.createServer(async (req, res) => {
    const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/health') return send(200, { status: 'ok', name });
    if (req.url === '/telemetry') return send(200, { requests, failures, durationTotal, logs, traces });
    if (req.url === '/fault' && req.method === 'POST') {
      if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) return send(403, { error: 'Loopback only' });
      fault = true; return send(200, { fault: true });
    }
    if (req.url !== '/request') return send(404, { error: 'Not found' });
    const start = performance.now(); let failed = false; requests++;
    try {
      await new Promise(resolve => setTimeout(resolve, 4 + sequence++ % 4));
      if (fault) {
        await new Promise(resolve => setTimeout(resolve, 90));
        failed = true;
        record(logs, { id: `live-l-${randomUUID()}`, ts: Date.now(), service: name, level: 'error', message: 'Resource unavailable: local fault-injection fixture' });
      } else {
        await Promise.all(dependencies.map(async dependency => {
          const then = performance.now(); let status = 'ok';
          try { const result = await fetch(`${dependency.url}/request`, { signal: AbortSignal.timeout(1500) }); if (!result.ok) status = 'error'; await result.arrayBuffer(); } catch { status = 'error'; }
          if (status === 'error') failed = true;
          record(traces, { id: `live-t-${randomUUID()}`, ts: Date.now(), caller: name, callee: dependency.name, durationMs: performance.now() - then, status });
        }));
      }
      if (failed && !fault) record(logs, { id: `live-l-${randomUUID()}`, ts: Date.now(), service: name, level: 'warn', message: 'A downstream dependency returned an error' });
      return send(failed ? 503 : 200, { service: name, ok: !failed });
    } finally { durationTotal += performance.now() - start; if (failed) failures++; }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { name, url: `http://127.0.0.1:${server.address().port}`, server };
}
