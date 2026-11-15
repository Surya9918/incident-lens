import { mkdirSync, writeFileSync } from 'node:fs';
import { makeIncident } from '../src/synthetic.js';
import { extractFeatures } from '../src/features.js';
import { trainModel } from '../src/model.js';
const seeds = Array.from({ length: 240 }, (_, i) => 1000 + i);
const cases = seeds.map(seed => {
  const { incident, truth } = makeIncident(seed);
  return { records: extractFeatures(incident), rootCause: truth.rootCause };
});
mkdirSync('models', { recursive: true });
for (const [name, mask] of [['ranker', []], ['no-graph', ['upstreamCoverage']], ['metrics-learned', ['logErrors', 'traceErrors', 'upstreamCoverage']]]) {
  const model = trainModel(cases, { mask });
  model.id = `synthetic-listwise-v1-${name}`;
  model.training.seedRange = [1000, 1239];
  model.training.data = 'Built-in single-fault simulator; shop topology only';
  writeFileSync(`models/${name}.json`, JSON.stringify(model, null, 2) + '\n');
  console.log(`Trained ${name} on ${cases.length} complete incidents`);
}
