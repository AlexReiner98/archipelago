// The shape of the code, checked. Files stay small; the kernel names no pack; writes to items and
// relations go through one path; a pack reaches the kernel only through what it is handed; a pack's
// code is tested without a database; kernel modules import one way; the UI loads as modules; and
// there are five dependencies.
//
// Each rule keeps a list of what already broke it when the rule was made (16 Oct 2026). An entry
// may only shrink, and goes once the rule is met: when you bring a number down, lower it here.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..');
const MAX_LINES = 500;
const CODE = /\.(ts|js|mjs|css|html)$/;
/** Vendored as a file at the owner's asking (CLAUDE.md), not written here. */
const VENDORED = ['ui/three.module.min.js'];

const walk = (dir: string): string[] =>
  !existsSync(join(ROOT, dir))
    ? []
    : readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = `${dir}/${name}`;
        return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
      });
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const lines = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
const codeFiles = ['src', 'ui', 'test', 'packs', 'scripts', 'examples'].flatMap(walk).filter((f) => CODE.test(f) && !VENDORED.includes(f));
const kernelFiles = [...walk('src'), ...walk('ui')].filter((f) => /\.(ts|js)$/.test(f) && !VENDORED.includes(f));
const packIds = readdirSync(join(ROOT, 'packs')).filter((p) => statSync(join(ROOT, 'packs', p)).isDirectory());
/** The kernel's own packs: the kinds, the root relations and the system tier. */
const KERNEL_PACKS = ['core', 'sys', 'local'];

/**
 * Compare what is counted with what is allowed: anything not listed may have up to `limit`; a listed
 * entry may not grow, and must be lowered (or removed, once within the limit) when it shrinks.
 */
function ratchet(counted: Record<string, number>, frozen: Record<string, number>, limit = 0): string[] {
  const problems: string[] = [];
  for (const [what, n] of Object.entries(counted)) {
    const cap = frozen[what] ?? limit;
    if (n > cap) problems.push(`${what}: ${n}, over ${cap}`);
  }
  for (const [what, cap] of Object.entries(frozen)) {
    const n = counted[what] ?? 0;
    if (n < cap) problems.push(n <= limit ? `${what}: ${n} now, within ${limit}: remove its entry` : `${what}: ${n} now: lower its entry from ${cap} to ${n}`);
  }
  return problems;
}

const count = (files: string[], pattern: RegExp) =>
  Object.fromEntries(files.map((f) => [f, read(f).match(pattern)?.length ?? 0]).filter(([, n]) => (n as number) > 0));

// 1. No file over 500 lines.
const LONG_FILES: Record<string, number> = {
  'src/views.ts': 505,
  'src/tools.ts': 1020,
  'src/pelago.ts': 1068,
  'ui/style.css': 778,
  'src/server.ts': 549,
  'src/sessions.ts': 501,
};

test(`no file is over ${MAX_LINES} lines`, () => {
  const counted = Object.fromEntries(codeFiles.map((f) => [f, lines(read(f))]));
  assert.deepEqual(ratchet(counted, LONG_FILES, MAX_LINES), [], 'Split the file into modules, each one thing.');
});

// 2. The kernel never names a pack's types or relations: it works from kinds and capabilities.
const NAMES_PACKS: Record<string, number> = {
  'ui/time.js': 2,
  'ui/week.js': 1,
  'src/views.ts': 6,
  'src/brief.ts': 2,
  'src/github.ts': 3,
  'src/github-app.ts': 1,
  'src/reader.ts': 1,
  'ui/doc.js': 1,
};

test('the kernel names no pack', () => {
  const ids = packIds.filter((p) => !KERNEL_PACKS.includes(p));
  const named = count(kernelFiles, new RegExp(`['"\`](?:${ids.join('|')})\\.[a-z_]+['"\`]`, 'g'));
  assert.deepEqual(ratchet(named, NAMES_PACKS), [], 'Ask the registry for a kind or a capability instead of naming a pack type.');
});

// 3. Writes to items and relations go through the write path (src/pelago.ts), apart from the
// operational state CLAUDE.md allows (sessions, claims, notifications) and restoring a backup.
const WRITES_ELSEWHERE: Record<string, number> = {
  'src/sessions.ts': 4,
  'src/automations.ts': 3,
  'src/backup.ts': 2,
  'src/notify.ts': 1,
  'src/outbox.ts': 1,
  'src/tools.ts': 1,
};

test('items and relations are written in one place', () => {
  const others = walk('src').filter((f) => f.endsWith('.ts') && f !== 'src/pelago.ts');
  const writes = count(others, /\b(?:insert\s+into|update|delete\s+from)\s+(?:entity|relation)\b/gi);
  assert.deepEqual(ratchet(writes, WRITES_ELSEWHERE), [], 'Send the change through Archipelago.change.');
});

// 4. A pack's code imports only its own files and Node's built-ins: never the kernel's source.
test("a pack's code imports nothing of the kernel", () => {
  const reaching: string[] = [];
  for (const file of walk('packs').filter((f) => /\.(ts|js|mjs)$/.test(f))) {
    for (const [, spec] of read(file).matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const own = spec.startsWith('./') || (spec.startsWith('../') && !relative(join(ROOT, 'packs', file.split('/')[1]), join(ROOT, file, '..', spec)).startsWith('..'));
      if (!own && !spec.startsWith('node:')) reaching.push(`${file} imports ${spec}`);
    }
  }
  assert.deepEqual(reaching, [], 'A pack is handed what it reads and answers with ops and requests.');
});

// 5. A pack that carries code carries the tests of it, run without a database: input and what was
// read go in, ops and requests come out.
test("a pack's code comes with its tests", () => {
  const untested = packIds.filter((p) => {
    const files = walk(`packs/${p}`);
    return files.some((f) => /\.(ts|js|mjs)$/.test(f) && !/\.test\./.test(f)) && !files.some((f) => /\.test\.(ts|js|mjs)$/.test(f));
  });
  assert.deepEqual(untested, [], 'Add a *.test.ts beside the handlers, fixtures in and ops out.');
});

// 6. Kernel modules import one way: no cycles. Type-only imports do not count.
const CYCLES: Record<string, number> = {
  'reader.ts -> tools.ts': 1,
  'tools.ts -> reader.ts': 1,
};

test('kernel modules import one way', () => {
  const files = walk('src').filter((f) => f.endsWith('.ts'));
  const edges = new Map(files.map((f) => [basename(f), [] as string[]]));
  for (const f of files) {
    for (const [, spec] of read(f).matchAll(/^import\s+(?!type\b)[^;]*?from\s+'\.\/([^']+\.ts)'/gm)) edges.get(basename(f))!.push(spec);
  }
  // Tarjan's strongly connected components: an edge inside one with more than one module is a cycle.
  const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], on = new Set<string>();
  const component = new Map<string, number>();
  let next = 0, comps = 0;
  const visit = (v: string) => {
    index.set(v, next); low.set(v, next++); stack.push(v); on.add(v);
    for (const w of edges.get(v) ?? []) {
      if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); }
      else if (on.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!));
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do { w = stack.pop()!; on.delete(w); component.set(w, comps); } while (w !== v);
      comps++;
    }
  };
  for (const v of edges.keys()) if (!index.has(v)) visit(v);
  const size = (c: number) => [...component.values()].filter((x) => x === c).length;
  const inCycles: Record<string, number> = {};
  for (const [v, ws] of edges) for (const w of ws) if (component.get(v) === component.get(w) && size(component.get(v)!) > 1) inCycles[`${v} -> ${w}`] = 1;
  assert.deepEqual(ratchet(inCycles, CYCLES), [], 'Move what both need into a module both import, or pass it in.');
});

// 7. The UI loads as native modules, with no build step.
const CLASSIC_SCRIPTS: Record<string, number> = {
  'ui/doc.html: <script src="/doc.js">': 1,
  'ui/public.html: <script src="/public.js">': 1,
  // The sandboxed drawing frame has no origin of its own; a module there is untried.
  'ui/draw.html: <script src="/draw.js">': 1,
};

test('the UI loads as modules', () => {
  const classic: Record<string, number> = {};
  for (const page of walk('ui').filter((f) => f.endsWith('.html'))) {
    for (const [tag] of read(page).matchAll(/<script\b[^>]*\bsrc=[^>]*>/g)) if (!/type="module"/.test(tag)) classic[`${page}: ${tag}`] = 1;
  }
  assert.deepEqual(ratchet(classic, CLASSIC_SCRIPTS), [], 'Load it with <script type="module"> and import what it needs.');
});

// 8. Four dependencies (CLAUDE.md); another only with the owner's agreement. Model calls are plain fetch (src/model.ts).
test('there are four dependencies', () => {
  const deps = Object.keys(JSON.parse(read('package.json')).dependencies ?? {}).sort();
  assert.deepEqual(deps, ['@electric-sql/pglite', '@modelcontextprotocol/sdk', 'pg', 'zod']);
});

// 9. Every module the page loads parses: one that does not leaves the page blank, and most are not run by a test.
// One process parses them all as modules, without running them: a process each took seconds.
const PARSE = `const { readFileSync } = await import('node:fs'); const { SourceTextModule } = await import('node:vm');
for (const f of process.argv.slice(1)) try { new SourceTextModule(readFileSync(f, 'utf8'), { identifier: f }); } catch { console.log(f); }`;
test('every UI module parses', () => {
  const files = walk('ui').filter((f) => f.endsWith('.js') && !VENDORED.includes(f));
  const run = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '--input-type=module', '-e', PARSE, ...files.map((f) => join(ROOT, f))], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const bad = run.stdout.split(/\r?\n/).filter(Boolean).map((f) => files.find((g) => join(ROOT, g) === f) ?? f);
  assert.deepEqual(bad, [], 'A module that does not parse leaves the page blank: run node --check on it.');
});
