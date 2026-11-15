import { extractFeatures, FEATURE_NAMES } from './features.js';
import { predict, standardize } from './model.js';

export function analyze(incident, model) {
  const records = extractFeatures(incident);
  const active = records.filter(r => r.anomalous);
  if (!active.length) return { status: 'no_anomaly', modelVersion: model.id, summary: 'No sustained metric anomaly was detected in this observation window. This does not prove the system is healthy.', candidates: [], signals: records, detectedAt: null, evidence: [], limitations: ['Logs alone do not trigger this detector.', 'Three consecutive anomalous metric samples are required.'] };
  const ranking = predict(records, model);
  const candidates = ranking.map(rank => {
    const r = records.find(x => x.service === rank.service);
    const transformed = standardize(r.features, model);
    const contributions = FEATURE_NAMES.map((feature, j) => ({ feature, value: r.features[j], contribution: transformed[j] * model.weights[j] })).sort((a, b) => b.contribution - a.contribution);
    return { service: r.service, rankingWeight: rank.weight, anomalous: r.anomalous, onset: r.onset, evidenceIds: r.evidenceIds, contributions, explanation: `${r.service}: median latency ${r.observedLatency.toFixed(1)} ms versus baseline ${r.baselineLatency.toFixed(1)} ms; ${(100 * r.persistence).toFixed(0)}% of observed samples exceed the detector threshold.` };
  });
  const ambiguous = candidates[0].rankingWeight - candidates[1].rankingWeight < 0.15;
  const ids = new Set(candidates.slice(0, 3).flatMap(c => c.evidenceIds));
  const evidence = [...incident.logs.map(l => ({ ...l, kind: 'log' })), ...incident.traces.map(t => ({ ...t, kind: 'trace' }))].filter(e => ids.has(e.id));
  return {
    status: ambiguous ? 'uncertain' : 'diagnosed', modelVersion: model.id,
    summary: `${candidates[0].service} is the highest-ranked hypothesis. ${ambiguous ? 'The leading candidates are close; collect more evidence before acting.' : 'Inspect its cited evidence and dependencies before taking action.'}`,
    candidates, signals: records, evidence,
    detectedAt: Math.min(...active.map(r => r.detectedAt)),
    limitations: ['Ranking weights are relative model scores, not calibrated probabilities.', 'Observational evidence suggests hypotheses; it does not establish causation.', 'The bundled ranker is trained on synthetic single-fault incidents, not validated on production workloads.', ...(incident.logs.length ? [] : ['Log evidence was not supplied.']), ...(incident.traces.length ? [] : ['Trace evidence was not supplied.'])]
  };
}
