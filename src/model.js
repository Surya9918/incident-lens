import { FEATURE_NAMES } from './features.js';
export const softmax = scores => {
  const max = Math.max(...scores), exp = scores.map(x => Math.exp(x - max));
  const total = exp.reduce((a, b) => a + b, 0);
  return exp.map(x => x / total);
};
export function validateModel(model) {
  if (model.version !== 1 || JSON.stringify(model.featureNames) !== JSON.stringify(FEATURE_NAMES) || model.weights?.length !== FEATURE_NAMES.length || model.means?.length !== FEATURE_NAMES.length || model.scales?.length !== FEATURE_NAMES.length || ![...model.weights, ...model.means, ...model.scales].every(Number.isFinite) || model.scales.some(s => s <= 0)) throw new Error('Invalid ranking model');
  return model;
}
export const standardize = (x, model) => x.map((v, j) => (v - model.means[j]) / model.scales[j]);
export function predict(records, model, mode = 'full') {
  if (mode === 'metrics') return records.map(r => ({ service: r.service, score: r.severity, weight: 0 })).sort((a, b) => b.score - a.score || a.service.localeCompare(b.service));
  const scores = records.map(r => standardize(r.features, model).reduce((sum, x, j) => sum + x * model.weights[j], 0));
  const probabilities = softmax(scores);
  return records.map((r, i) => ({ service: r.service, score: scores[i], weight: probabilities[i] })).sort((a, b) => b.score - a.score || a.service.localeCompare(b.service));
}
/** Listwise multinomial logistic ranker trained against a known fault service. */
export function trainModel(cases, { epochs = 450, rate = 0.035, l2 = 0.02, mask = [] } = {}) {
  const all = cases.flatMap(c => c.records.map(r => r.features));
  const means = FEATURE_NAMES.map((_, j) => all.reduce((s, r) => s + r[j], 0) / all.length);
  const scales = means.map((m, j) => Math.max(0.01, Math.sqrt(all.reduce((s, r) => s + (r[j] - m) ** 2, 0) / all.length)));
  const model = { version: 1, featureNames: FEATURE_NAMES, means, scales, weights: FEATURE_NAMES.map(() => 0), training: { cases: cases.length, epochs, rate, l2, maskedFeatures: mask } };
  const normalized = cases.map(c => ({ target: c.records.findIndex(r => r.service === c.rootCause), rows: c.records.map(r => standardize(r.features, model)) }));
  if (normalized.some(c => c.target < 0)) throw new Error('Training label is not a service');
  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradient = model.weights.map(() => 0);
    for (const c of normalized) {
      const p = softmax(c.rows.map(row => row.reduce((s, x, j) => s + x * model.weights[j], 0)));
      c.rows.forEach((row, i) => row.forEach((x, j) => { gradient[j] += (p[i] - Number(i === c.target)) * x; }));
    }
    model.weights = model.weights.map((w, j) => mask.includes(FEATURE_NAMES[j]) ? 0 : w - rate * (gradient[j] / cases.length + l2 * w));
  }
  return validateModel(model);
}
