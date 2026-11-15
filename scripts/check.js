import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
function files(dir) { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]); }
for (const file of ['src', 'scripts', 'demo', 'test', 'public'].flatMap(files).filter(f => f.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { console.error(result.stderr); process.exit(1); }
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
if (Object.keys(pkg.dependencies || {}).length) throw new Error('Review dependency policy before adding runtime packages');
console.log('All JavaScript syntax checks passed; no third-party runtime dependencies.');
