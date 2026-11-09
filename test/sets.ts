// Which test files run (scripts/test.ts). npm test runs the fast set, after every change; npm run test:full runs every
// file, before a commit to main and in CI; npm run test:changed runs the files a change can reach.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');

/**
 * Left out of the fast set, each for what makes it slow. What they protect is still checked by the full run, by CI on
 * every pull request, and by test:changed when a change reaches them. The structure test is never here.
 * test/sets.test.ts holds the fast set to LONG by the weights: a file past it comes here, as 'long'.
 */
export const SLOW: Record<string, string> = {
  // A headless Chrome each, and the page loaded and driven in it: seconds per test, most of a core under load.
  'test/agents-beside.test.ts': 'browser',
  'test/canvas-drag.test.ts': 'browser',
  'test/canvas-pan.test.ts': 'browser',
  'test/canvas-pinch.test.ts': 'browser',
  'test/canvas-replica.test.ts': 'browser',
  'test/canvas-wires.test.ts': 'browser',
  'test/canvas-zoom.test.ts': 'browser',
  'test/docs-beside.test.ts': 'browser',
  'test/layout-asks.test.ts': 'browser',
  'test/code-style-starts.test.ts': 'browser',
  'test/layouts.test.ts': 'browser',
  'test/layouts-open.test.ts': 'browser',
  'test/layouts-queued.test.ts': 'browser',
  'test/find-query.test.ts': 'browser',
  'test/kept-views.test.ts': 'browser',
  'test/looks.test.ts': 'browser',
  'test/mcp-view-host.test.ts': 'browser',
  'test/narrow-bar.test.ts': 'browser',
  'test/panes.test.ts': 'browser',
  'test/published-frames.test.ts': 'browser',
  'test/query-line.test.ts': 'browser',
  'test/saved-canvases.test.ts': 'browser',
  'test/saved-canvases-narrow.test.ts': 'browser',
  'test/saved-canvases-switch.test.ts': 'browser',
  'test/show-lands.test.ts': 'browser',
  'test/show-follows.test.ts': 'browser',
  'test/show-tab-life.test.ts': 'browser',
  'test/show-web.test.ts': 'browser',
  'test/stable-page.test.ts': 'browser',
  'test/style-items.test.ts': 'browser',
  'test/tabs.test.ts': 'browser',
  'test/tabs-busy.test.ts': 'browser',
  'test/tabs-canvas.test.ts': 'browser',
  'test/tips.test.ts': 'browser',
  'test/traces-page.test.ts': 'browser',
  'test/transition-browser.test.ts': 'browser',
  'test/walk-from.test.ts': 'browser',
  // A whole map moved, backed up, restored, migrated or pulled: databases opened, filled and replayed from the log,
  // 8 to 29 seconds of one process each in CI. test:changed runs them for a change to what they import.
  'test/backup.test.ts': 'whole map',
  'test/backup-tools.test.ts': 'whole map',
  'test/control.test.ts': 'whole map',
  'test/migrate.test.ts': 'whole map',
  'test/move.test.ts': 'whole map',
  'test/pull.test.ts': 'whole map',
  'test/snapshots.test.ts': 'whole map',
  'test/stats.test.ts': 'whole map',
  // The approvals table: about 4000 changes, a policy's settings dealt between two files (test/approvals.ts, PARTS).
  'test/approvals-review-1.test.ts': 'table',
  'test/approvals-review-2.test.ts': 'table',
  'test/approvals-dev-1.test.ts': 'table',
  'test/approvals-dev-2.test.ts': 'table',
  'test/approvals-mixed-1.test.ts': 'table',
  'test/approvals-mixed-2.test.ts': 'table',
  // The map of a few hundred items drawn whole through its budget, timed: about 22 seconds.
  'packs/core/map-time.test.ts': 'timed',
  // Dense pictures drawn six times over, each checked: about 22 seconds.
  'packs/core/map-routing.test.ts': 'long',
  // Many tests in one file, past LONG seconds of one process in CI (test/weights.json, 8 Nov 2026).
  'test/sessions.test.ts': 'long',
  'test/query-flat.test.ts': 'long',
  'test/new-workspace.test.ts': 'long',
  'test/seeing.test.ts': 'long',
  'test/handoff.test.ts': 'long',
  'test/setup.test.ts': 'long',
};

/** The most seconds a file of the fast set may take in CI, on either engine (test/weights.json). */
export const LONG = 15;

const walk = (dir: string): string[] =>
  !existsSync(join(ROOT, dir)) ? [] : readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(`${dir}/${e.name}`)) : [`${dir}/${e.name}`]));

/** Every test file npm test:full runs, as paths from the repository's root. */
export const allTests = () => [...walk('test').filter((f) => /^test\/[^/]+\.test\.ts$/.test(f)), ...walk('packs').filter((f) => /^packs\/[^/]+\/[^/]+\.test\.ts$/.test(f))].sort();

export const fastTests = () => allTests().filter((f) => !(f in SLOW));

/**
 * What test/weights.json holds, measured in CI by scripts/test-weights.ts: for each file, the seconds its tests took
 * on each engine; and the seconds of the steps that only shard 1 runs (FIRST_STEPS), on each engine.
 */
export type Weights = { files: Record<string, Record<string, number>>; steps: Record<string, number> };
export const ENGINES = ['pglite', 'postgres'];
/** How many files a CI runner (4 cores) runs at once: node runs one fewer than it has. */
export const LANES = 3;
/** What a file costs beyond its tests' own time: a process started and its modules loaded (fitted to CI, 3 Nov 2026). */
export const PER_FILE = 0.6;
/**
 * How much more of a runner a browser test's second takes than another's: its Chrome draws on cores of its own beside
 * the test's process (fitted to main's run 41751821168, 4 Nov 2026: the shards with most browser seconds ran longest).
 */
export const BROWSER = 1.7;
/**
 * The files CI runs again on Postgres as a role that is not a superuser (node scripts/test.ts unprivileged, the step
 * FIRST_STEPS names second): the log's triggers, its lock, the move and the keys, which a superuser would pass however
 * they were granted.
 */
export const UNPRIVILEGED = ['test/log.test.ts', 'test/connections.test.ts', 'test/move.test.ts', 'test/streams.test.ts', 'test/keys.test.ts'];
/** The steps of the workflow that run on shard 1 alone, beside its tests; their time counts toward it. */
export const FIRST_STEPS = ['Type check', 'The log as a role that is not a superuser'];

export const readWeights = (): Weights => JSON.parse(readFileSync(join(ROOT, 'test/weights.json'), 'utf8'));

/**
 * The seconds of a runner a file takes on an engine: as measured, or the middle of those measured when it is new, and
 * a browser test's BROWSER times over.
 */
export function weigher(weights = readWeights()) {
  const middle = Object.fromEntries(ENGINES.map((e) => [e, Object.values(weights.files).map((w) => w[e] ?? 0).sort((a, b) => a - b)]).map(([e, ws]) => [e, (ws as number[])[(ws as number[]).length >> 1] ?? 1]));
  return (f: string, engine: string) => (weights.files[f]?.[engine] ?? middle[engine]) * (SLOW[f] === 'browser' ? BROWSER : 1);
}

/** Files heaviest first, as node is given them: it starts them in that order, so the longest do not start last. */
export const heaviestFirst = (files: string[], engine: string, weight = weigher()) => [...files].sort((a, b) => weight(b, engine) - weight(a, engine) || (a < b ? -1 : 1));

/** The seconds a shard is expected to take: its files dealt in order to LANES lanes, each to the one free first, and its steps after. */
export function predict(files: string[], engine: string, steps = 0, weight = weigher()): number {
  const lanes = Array<number>(LANES).fill(0);
  for (const f of heaviestFirst(files, engine, weight)) lanes[lanes.indexOf(Math.min(...lanes))] += weight(f, engine) + PER_FILE;
  return Math.max(...lanes) + steps;
}

/**
 * CI runs the full set as N shards side by side (.github/workflows/tests.yml), named "1/N" to "N/N", so a push waits
 * as long as its slowest shard rather than for every file in turn. Every file of the full run is dealt to one, by
 * the time it took in CI (test/weights.json), heaviest first. The browser tests go first, each to the part with the
 * fewest browser seconds so far: Chromes side by side on one runner slow each other far past BROWSER (main's run of 4
 * Nov 2026: a shard of five took 123 s, its files up to four times their weight). The rest then go each to the part
 * whose predicted time (predict, its lanes and on shard 1 FIRST_STEPS) it raises least, on the heavier engine.
 * sets.test.ts checks the workflow runs every file once, and that the heaviest shard keeps under a budget.
 */
export function shard(part: string, weights = readWeights()): string[] {
  const [k, n] = part.split('/').map(Number);
  if (!(n >= 1 && k >= 1 && k <= n)) throw new Error(`No shard ${part}: say k/n`);
  const weight = weigher(weights);
  const steps = (i: number, e: string) => (i ? 0 : (weights.steps[e] ?? 0));
  const parts = Array.from({ length: n }, (_, i) => ({ files: [] as string[], browser: Math.max(...ENGINES.map((e) => steps(i, e))) * LANES }));
  const heavier = (f: string) => Math.max(...ENGINES.map((e) => weight(f, e)));
  const browser = (f: string) => SLOW[f] === 'browser';
  const order = (fs: string[]) => fs.sort((a, b) => heavier(b) - heavier(a) || (a < b ? -1 : 1));
  const tests = allTests();
  for (const f of order(tests.filter(browser))) {
    const after = (p: (typeof parts)[number]) => Math.max(p.browser + heavier(f), ...ENGINES.map((e) => predict([...p.files, f], e, 0, weight)));
    const best = parts.reduce((min, p) => (after(p) < after(min) || (after(p) === after(min) && p.browser < min.browser) ? p : min));
    best.files.push(f);
    best.browser += heavier(f) + PER_FILE;
  }
  for (const f of order(tests.filter((t) => !browser(t)))) {
    const after = (i: number) => Math.max(...ENGINES.map((e) => predict([...parts[i].files, f], e, steps(i, e), weight)));
    const best = parts.reduce((min, _, i) => (after(i) < after(min) ? i : min), 0);
    parts[best].files.push(f);
  }
  return parts[k - 1].files.sort();
}

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
 * What every test may read without importing or naming it: the packs' manifests (each test's map starts with every
 * pack), what src/ keeps that is not a module (the schema), and the dependencies. A change to one reaches every test.
 */
export const shared = (file: string) => /^packs\/[^/]+\/pack\.json$/.test(file) || (file.startsWith('src/') && !/\.(ts|js|mjs)$/.test(file)) || /^package(-lock)?\.json$/.test(file);

const texts = new Map<string, string>();
const textOf = (test: string) => {
  if (!texts.has(test)) texts.set(test, readFileSync(join(ROOT, test), 'utf8'));
  return texts.get(test)!;
};
/** A test that names a folder of these reads the files in it by listing them (the pages' words, the docs' terms). */
const LISTED = ['ui', 'docs'];
const lists = (test: string, folder: string) => new RegExp(`['"\`/]${folder}/|['"]${folder}['"]`).test(textOf(test));

/**
 * Whether a test may read a file: it imports it (at any depth), names it by its path, or reads it another way. A
 * browser test reads every page (ui/); a test that names ui/ or docs/ lists their files; a test that names a file's
 * folder within its pack (`layouts/flow/`) reads that folder's code by path, and a browser test one that names its
 * layout (`flow`). That last is a guess, good enough to choose what to run (CI runs the rest); `wide` asks for what
 * a browser test could draw, every pack's code, for when a pass is reused (test/passes.ts) and a guess will not do.
 */
export function reads(test: string, file: string, wide = false): boolean {
  if (reaches(test).has(file) || textOf(test).includes(file)) return true;
  const browser = SLOW[test] === 'browser';
  const top = file.split('/')[0];
  if (LISTED.includes(top)) return (top === 'ui' && browser) || lists(test, top);
  const inPack = /^packs\/[^/]+\/(.+)$/.exec(file)?.[1];
  if (!inPack || /\.test\.ts$/.test(file)) return false;
  if (browser && wide) return true;
  const folder = dirname(inPack);
  if (folder !== '.' && textOf(test).includes(`${folder}/`)) return true;
  const layout = /^layouts\/([\w-]+)\//.exec(inPack)?.[1];
  return textOf(test).includes(inPack) || (browser && !!layout && new RegExp(`\\b${layout}\\b`).test(textOf(test)));
}

/**
 * The test files a change to these files can reach: each test that reads one (reads), and the structure test always.
 * Nearly every test imports the kernel's core (src/pelago.ts), so a change there reaches nearly all of them; this
 * mode saves most for a change to a pack's code, a page, a script, the docs or a test. What every test reads (shared),
 * and a file under src/, ui/ or packs/ no test is seen to read (a handler the server loads by its path), could be read
 * by any test, so it runs the fast set with them. CI runs every file before main deploys, so what this misses is
 * caught there.
 */
export function affected(changed: string[]): { files: string[]; why: string } {
  const tests = allTests();
  const picked = new Set<string>(['test/structure.test.ts']);
  const unreached: string[] = [];
  for (const file of changed) {
    const by = tests.filter((t) => reads(t, file));
    by.forEach((t) => picked.add(t));
    // A file that is gone is read by no one now: what read it changed with it.
    if (shared(file) || (/^(src|ui|packs)\//.test(file) && !by.length && existsSync(join(ROOT, file)))) unreached.push(file);
  }
  if (unreached.length) fastTests().forEach((f) => picked.add(f));
  const files = tests.filter((t) => picked.has(t));
  const what = unreached.slice(0, 2).join(', ') + (unreached.length > 2 ? ', …' : '');
  return { files, why: unreached.length ? `${what} may be read by any test: the fast set, with what reaches the rest` : `${files.length} of ${tests.length} files reach what changed` };
}
