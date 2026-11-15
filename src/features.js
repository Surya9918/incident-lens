export const FEATURE_NAMES = ['severity', 'persistence', 'earliness', 'cpuShift', 'errorShift', 'logErrors', 'traceErrors', 'upstreamCoverage'];
export const median = values => {
  const x = [...values].sort((a, b) => a - b);
  if (!x.length) return 0;
  const i = Math.floor(x.length / 2);
  return x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2;
};
const clamp = (n, max = 12) => Math.min(max, Math.max(0, n));
function detector(baseline, key, floor) {
  const center = median(baseline.map(m => m[key]));
  const scale = Math.max(floor, median(baseline.map(m => Math.abs(m[key] - center))) * 1.4826);
  return { center, scale, score: row => clamp((row[key] - center) / scale) };
}
/** Call edges point from caller to dependency. Find all transitive callers. */
export function ancestors(service, edges) {
  const seen = new Set([service]), queue = [service];
  while (queue.length) {
    const current = queue.shift();
    for (const [caller, dependency] of edges) if (dependency === current && !seen.has(caller)) { seen.add(caller); queue.push(caller); }
  }
  seen.delete(service);
  return [...seen];
}

export function extractFeatures(incident) {
  const records = incident.services.map(service => {
    const rows = incident.metrics.filter(m => m.service === service).sort((a, b) => a.ts - b.ts);
    const baseline = rows.filter(m => m.ts <= incident.baselineEnd);
    const observed = rows.filter(m => m.ts > incident.baselineEnd);
    const latency = detector(baseline, 'latencyMs', 5);
    const error = detector(baseline, 'errorRate', 0.02);
    const cpu = detector(baseline, 'cpuPct', 5);
    const series = observed.map(m => ({ ts: m.ts, score: Math.max(latency.score(m), error.score(m), cpu.score(m)) }));
    const first = series.findIndex((m, i) => m.score >= 3 && series[i + 1]?.score >= 3 && series[i + 2]?.score >= 3);
    const onset = first < 0 ? null : series[first].ts;
    // Detection time is the THIRD sample, not the retrospectively inferred onset.
    const detectedAt = first < 0 ? null : series[first + 2].ts;
    const logs = incident.logs.filter(l => l.service === service && l.ts > incident.baselineEnd && l.level === 'error');
    const traces = incident.traces.filter(t => t.callee === service && t.ts > incident.baselineEnd);
    const badTraces = traces.filter(t => t.status === 'error');
    return {
      service, onset, detectedAt, anomalous: onset !== null,
      severity: median(series.map(s => s.score)),
      persistence: series.filter(s => s.score >= 3).length / series.length,
      cpuShift: median(observed.map(cpu.score)), errorShift: median(observed.map(error.score)),
      logErrors: Math.min(1, logs.length / observed.length),
      traceErrors: badTraces.length / Math.max(1, traces.length),
      evidenceIds: [...logs.slice(0, 3), ...badTraces.slice(0, 3)].map(x => x.id),
      baselineLatency: latency.center, observedLatency: median(observed.map(m => m.latencyMs)), series
    };
  });
  const abnormal = records.filter(r => r.anomalous);
  const firstTs = abnormal.length ? Math.min(...abnormal.map(r => r.onset)) : incident.baselineEnd;
  const lastTs = Math.max(...incident.metrics.map(m => m.ts));
  for (const r of records) {
    r.earliness = r.onset === null ? 0 : 1 - (r.onset - firstTs) / Math.max(1, lastTs - firstTs);
    r.upstreamCoverage = ancestors(r.service, incident.edges).filter(s => abnormal.some(a => a.service === s && a.onset >= r.onset && r.onset !== null)).length / Math.max(1, abnormal.length - 1);
    r.features = FEATURE_NAMES.map(name => r[name]);
  }
  return records;
}
