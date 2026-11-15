// Deterministic fixtures, deliberately separate from the inference implementation.
export function random(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export const FAULTS = ['latency', 'errors', 'cpu'];
export function makeIncident(seed = 1, { clean = false, fault, topology = 'shop' } = {}) {
  const rng = random(seed), normal = () => Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-8))) * Math.cos(2 * Math.PI * rng());
  const services = ['gateway', 'checkout', 'payments', 'inventory', 'database', 'cache'];
  const edges = topology === 'chain' ? [['gateway', 'checkout'], ['checkout', 'payments'], ['payments', 'inventory'], ['inventory', 'database'], ['database', 'cache']] : [['gateway', 'checkout'], ['checkout', 'payments'], ['checkout', 'inventory'], ['payments', 'database'], ['inventory', 'database'], ['inventory', 'cache']];
  const rootCause = clean ? null : services[Math.floor(rng() * services.length)];
  const kind = fault ?? FAULTS[Math.floor(rng() * FAULTS.length)];
  const baseTs = 1735689600000 + seed * 100000;
  const onsetIndex = 32 + Math.floor(rng() * 4);
  // Propagation delays are generated along call dependencies, not by ranker scores.
  const distance = new Map(rootCause ? [[rootCause, 0]] : []);
  for (let i = 0; i < services.length; i++) for (const [caller, callee] of edges) if (distance.has(callee) && (!distance.has(caller) || distance.get(caller) > distance.get(callee) + 1)) distance.set(caller, distance.get(callee) + 1);
  const baselines = new Map(services.map(s => [s, { latency: 20 + rng() * 70, cpu: 12 + rng() * 25 }]));
  const metrics = [], logs = [], traces = [];
  for (let t = 0; t < 55; t++) {
    const ts = baseTs + t * 1000;
    for (const service of services) {
      const base = baselines.get(service), d = distance.get(service);
      const affected = d !== undefined && t >= onsetIndex + d * 2;
      const root = service === rootCause;
      const severity = affected ? (root ? 1 : 0.65 + 0.3 * d) : 0;
      // Occasional benign spikes and error logs force persistence-based detection.
      const spike = rng() < 0.018 ? 70 : 0;
      const latencyMs = Math.max(1, base.latency + normal() * 4 + spike + severity * (kind === 'latency' ? 100 : 35) * (0.8 + rng() * 0.4));
      const errorRate = Math.max(0, Math.min(1, 0.008 + normal() * 0.005 + severity * (kind === 'errors' ? 0.35 : 0.08) * rng()));
      const cpuPct = Math.max(0, Math.min(100, base.cpu + normal() * 2 + (affected && root && kind === 'cpu' ? 55 : 0)));
      metrics.push({ ts, service, latencyMs, errorRate, cpuPct });
      if ((affected && rng() < (root ? 0.6 : 0.25)) || rng() < 0.015) logs.push({ id: `l-${t}-${service}`, ts, service, level: 'error', message: affected && root ? `${kind} threshold exceeded while processing request` : 'Downstream request did not complete within its budget' });
    }
    for (const [caller, callee] of edges) {
      const d = distance.get(callee), affected = d !== undefined && t >= onsetIndex + d * 2;
      traces.push({ id: `t-${t}-${caller}-${callee}`, ts, caller, callee, durationMs: Math.max(1, 10 + normal() * 2 + (affected ? 100 + rng() * 80 : 0)), status: affected && rng() < 0.65 ? 'error' : 'ok' });
    }
  }
  return {
    incident: { title: clean ? 'Synthetic healthy window' : 'Synthetic service degradation', services, edges, baselineEnd: baseTs + 29 * 1000, metrics, logs, traces },
    truth: { rootCause, fault: clean ? 'none' : kind, onset: clean ? null : baseTs + onsetIndex * 1000, seed, topology }
  };
}
