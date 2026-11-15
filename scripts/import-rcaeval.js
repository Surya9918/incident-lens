import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { importMetricsCsv } from '../src/import-csv.js';
const [csv, mapping, output] = process.argv.slice(2);
if (!csv || !mapping || !output) { console.error('Usage: node scripts/import-rcaeval.js data.csv mapping.json output.json'); process.exit(1); }
if (statSync(csv).size > 10 * 1024 * 1024) throw new Error('Select an incident window under 10 MiB first');
const incident = importMetricsCsv(readFileSync(csv, 'utf8'), JSON.parse(readFileSync(mapping, 'utf8')));
writeFileSync(output, JSON.stringify(incident, null, 2), { flag: 'wx' });
console.log(`Imported ${incident.metrics.length} metric samples. No root-cause labels, logs or traces were inferred.`);
