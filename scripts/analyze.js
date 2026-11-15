import { readFileSync } from 'node:fs';
import { sanitizeIncident } from '../src/schema.js';
import { analyze } from '../src/analyze.js';
import { validateModel } from '../src/model.js';
if (!process.argv[2]) { console.error('Usage: node scripts/analyze.js incident.json'); process.exit(1); }
const incident = sanitizeIncident(JSON.parse(readFileSync(process.argv[2], 'utf8')));
const model = validateModel(JSON.parse(readFileSync(new URL('../models/ranker.json', import.meta.url), 'utf8')));
console.log(JSON.stringify(analyze(incident, model), null, 2));
