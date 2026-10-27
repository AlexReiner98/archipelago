// How long each file of a shard takes alone, four at a time, written to test/weights.json for shard() to deal the
// parts by (test/sets.ts). Run it again when the parts drift apart in CI:
//   node scripts/test-weights.ts rest
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { blankImageFile } from '../src/db.ts';
import { ROOT, shard } from '../test/sets.ts';

const files = shard(process.argv[2] ?? 'rest');
if (!process.env.PELAGO_TEST_DATABASE_URL) process.env.PELAGO_TEST_IMAGE = await blankImageFile();
const file = join(ROOT, 'test/weights.json');
const weights: Record<string, number> = JSON.parse(readFileSync(file, 'utf8'));
let next = 0;
const run = async (): Promise<void> => {
  const f = files[next++];
  if (!f) return;
  const start = Date.now();
  await new Promise((done) => spawn(process.execPath, ['--test', '--test-force-exit', '--import', './test/each.ts', f], { cwd: ROOT, stdio: 'ignore' }).on('exit', done));
  weights[f] = Math.max(1, Math.round((Date.now() - start) / 1000));
  return run();
};
await Promise.all([run(), run(), run(), run()]);
const sorted = Object.fromEntries(Object.entries(weights).sort(([a], [b]) => (a < b ? -1 : 1)));
writeFileSync(file, `${JSON.stringify(sorted, null, 1)}\n`);
console.log(`${files.length} files weighed`);
