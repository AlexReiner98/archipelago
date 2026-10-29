// Which test files run (scripts/test.ts). npm test runs the fast set, after every change; npm run test:full runs every
// file, before a commit to main and in CI; npm run test:changed runs the files a change can reach.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');

/**
 * Left out of the fast set, each for what makes it slow. What they protect is still checked by the full run, by CI on
 * every pull request, and by test:changed when a change reaches them. The structure test is never here.
 */
export const SLOW: Record<string, string> = {
  // A headless Chrome each, and the page loaded and driven in it: seconds per test, most of a core under load.
  'test/canvas-drag.test.ts': 'browser',
  'test/canvas-replica.test.ts': 'browser',
  'test/canvas-wires.test.ts': 'browser',
  'test/canvas-zoom.test.ts': 'browser',
  'test/drawings-moved.test.ts': 'browser',
  'test/drawing-asks.test.ts': 'browser',
  'test/drawings.test.ts': 'browser',
  'test/find-lens.test.ts': 'browser',
  'test/kept-views.test.ts': 'browser',
  'test/looks.test.ts': 'browser',
  'test/narrow-bar.test.ts': 'browser',
  'test/panes.test.ts': 'browser',
  'test/published-frames.test.ts': 'browser',
  'test/query-line.test.ts': 'browser',
  'test/saved-canvases.test.ts': 'browser',
  'test/stable-page.test.ts': 'browser',
  'test/tabs.test.ts': 'browser',
  'test/walk-from.test.ts': 'browser',
  // A whole map moved, backed up, restored, migrated or pulled: databases opened, filled and replayed from the log,
  // 6 to 16 seconds of one process each. test:changed runs them for a change to what they import.
  'test/backup.test.ts': 'whole map',
  'test/backup-tools.test.ts': 'whole map',
  'test/control.test.ts': 'whole map',
  'test/migrate.test.ts': 'whole map',
  'test/move.test.ts': 'whole map',
  'test/pull.test.ts': 'whole map',
  'test/snapshots.test.ts': 'whole map',
  'test/stats.test.ts': 'whole map',
  // The approvals table: about 2800 changes, half a minute per policy.
  'test/approvals.test.ts': 'table',
  'test/approvals-dev.test.ts': 'table',
  'test/approvals-mixed.test.ts': 'table',
};

const walk = (dir: string): string[] =>
  !existsSync(join(ROOT, dir)) ? [] : readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));

/** Every test file npm test:full runs, as paths from the repository's root. */
export const allTests = () => [...walk('test').filter((f) => /^test\/[^/]+\.test\.ts$/.test(f)), ...walk('packs').filter((f) => /^packs\/[^/]+\/[^/]+\.test\.ts$/.test(f))].sort();

export const fastTests = () => allTests().filter((f) => !(f in SLOW));

/**
 * CI runs the full set as shards side by side (.github/workflows/tests.yml), so a push waits as long as its slowest
 * shard rather than for every file in turn: one for the fast set ("rest"), one for each reason in SLOW (its words
 * joined by "-"), and a shard split further as "rest 1/3", "rest 2/3", ... Every file is in exactly one shard;
 * sets.test.ts checks the workflow names them all. The parts are dealt by weight, heaviest first, each file to the
 * lightest part so far: the seconds each file took alone (test/weights.json, measured with scripts/test-weights.ts;
 * only their order matters), a file not there counted as the middle one.
 */
export function shard(name: string, part = '1/1'): string[] {
  const [k, n] = part.split('/').map(Number);
  if (!(n >= 1 && k >= 1 && k <= n)) throw new Error(`No part ${part}: say k/n`);
  const files = allTests().filter((f) => (f in SLOW ? SLOW[f].replaceAll(' ', '-') : 'rest') === name);
  if (!files.length) throw new Error(`No shard ${name}`);
  const weights: Record<string, number> = JSON.parse(readFileSync(join(ROOT, 'test/weights.json'), 'utf8'));
  const known = Object.values(weights).sort((a, b) => a - b);
  const weight = (f: string) => weights[f] ?? known[known.length >> 1] ?? 1;
  const parts = Array.from({ length: n }, () => ({ files: [] as string[], load: 0 }));
  for (const f of [...files].sort((a, b) => weight(b) - weight(a) || (a < b ? -1 : 1))) {
    const lightest = parts.reduce((min, p) => (p.load < min.load ? p : min));
    lightest.files.push(f);
    lightest.load += weight(f);
  }
  return parts[k - 1].files.sort();
}

/** The names of the shards. */
export const shardNames = () => ['rest', ...new Set(Object.values(SLOW).map((r) => r.replaceAll(' ', '-')))];

const SPECIFIER = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;

const direct = new Map<string, string[]>();
/** The files of this repository a module imports itself. */
function importsOf(file: string): string[] {
  if (!direct.has(file))
    direct.set(file, !existsSync(join(ROOT, file)) ? [] : [...readFileSync(join(ROOT, file), 'utf8').matchAll(SPECIFIER)].map((m) => relative(ROOT, resolve(ROOT, dirname(file), m[1] ?? m[2] ?? m[3])).replaceAll('\\', '/')).filter((to) => !to.startsWith('..')));
  return direct.get(file)!;
}

/** The files of this repository a module imports, directly or not, itself included. */
export function reaches(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const to of importsOf(file)) reaches(to, seen);
  return seen;
}

/**
 * The test files a change to these files can reach: each test that imports one (at any depth) or names it by its
 * path, and the structure test always. Nearly every test imports the kernel's core (src/pelago.ts), so a change
 * there reaches nearly all of them; this mode saves most for a change to a pack's code, a page, a script, the docs or
 * a test. A file under src/ or ui/ that is not a module some test imports (the schema, a stylesheet), and any file of
 * a pack but its tests (a manifest, a handler the server loads by its path), could be read by any test, so it runs
 * the fast set with them; a page the server serves (ui/) runs the browser tests too.
 */
export function affected(changed: string[]): { files: string[]; why: string } {
  const tests = allTests();
  const imports = new Map(tests.map((t) => [t, reaches(t)]));
  const text = new Map(tests.map((t) => [t, readFileSync(join(ROOT, t), 'utf8')]));
  const picked = new Set<string>(['test/structure.test.ts']);
  const unreached: string[] = [];
  for (const file of changed) {
    const by = tests.filter((t) => imports.get(t)!.has(file) || text.get(t)!.includes(file));
    by.forEach((t) => picked.add(t));
    const packCode = /^packs\//.test(file) && !/\.test\.ts$/.test(file);
    if (packCode || (/^(src|ui)\//.test(file) && !(/\.(ts|js|mjs)$/.test(file) && tests.some((t) => imports.get(t)!.has(file))))) unreached.push(file);
    if (file.startsWith('ui/')) Object.keys(SLOW).filter((f) => SLOW[f] === 'browser').forEach((f) => picked.add(f));
  }
  if (unreached.length) fastTests().forEach((f) => picked.add(f));
  const files = tests.filter((t) => picked.has(t));
  const what = unreached.slice(0, 2).join(', ') + (unreached.length > 2 ? ', …' : '');
  return { files, why: unreached.length ? `${what} may be read by any test: the fast set, with what reaches the rest` : `${files.length} of ${tests.length} files reach what changed` };
}
