// The shape of the code, checked. Files stay small; the kernel names no pack; writes to items and
// relations go through one path; a pack reaches the kernel only through what it is handed; a pack's
// code is tested without a database; kernel modules import one way; the UI loads as modules; and
// there are five dependencies; every picture is a drawing a pack ships; and every view the kernel answers is a
// lens preset or named as operational.
//
// Each rule keeps a list of what already broke it when the rule was made (16 Oct 2026). An entry
// may only shrink, and goes once the rule is met: when you bring a number down, lower it here.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { test } from 'node:test';
import { MAP_TABLES, RESTORE, STORES, VIEWS_OPERATIONAL } from '../src/operational.ts';

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
  'src/tools.ts': 903,
  'src/pelago.ts': 853,
  'ui/style.css': 732,
};

test(`no file is over ${MAX_LINES} lines`, () => {
  const counted = Object.fromEntries(codeFiles.map((f) => [f, lines(read(f))]));
  assert.deepEqual(ratchet(counted, LONG_FILES, MAX_LINES), [], 'Split the file into modules, each one thing.');
});

// 2. The kernel never names a pack's types or relations: it works from kinds and capabilities.
const NAMES_PACKS: Record<string, number> = {};

test('the kernel names no pack', () => {
  const ids = packIds.filter((p) => !KERNEL_PACKS.includes(p));
  const named = count(kernelFiles, new RegExp(`['"\`](?:${ids.join('|')})\\.[a-z_]+['"\`]`, 'g'));
  assert.deepEqual(ratchet(named, NAMES_PACKS), [], 'Ask the registry for a kind or a capability instead of naming a pack type.');
});

// 3. Writes to items and relations go through the write path (src/pelago.ts): change for facts, projected by the
// projector it runs (src/replay.ts), and the operational writes and the restore path src/operational.ts names.
// Every other store is named there too.
const WRITES_ELSEWHERE: Record<string, number> = {};

test('items and relations are written in one place', () => {
  const others = walk('src').filter((f) => f.endsWith('.ts') && f !== 'src/pelago.ts' && f !== 'src/replay.ts');
  const writes = count(others, /\b(?:insert\s+into|update|delete\s+from)\s+(?:entity|relation)\b/gi);
  assert.deepEqual(ratchet(writes, WRITES_ELSEWHERE), [], 'Send the change through Archipelago.change.');
});

test('every store is named, with its rule', () => {
  const tables = [...new Set(codeFiles.filter((f) => f.startsWith('src/')).flatMap((f) => [...read(f).matchAll(/create table if not exists (\w+)/gi)].map((m) => m[1])))];
  const named = [...MAP_TABLES, ...Object.keys(STORES)];
  assert.deepEqual(tables.filter((t) => !named.includes(t)), [], 'Name the store in src/operational.ts, with the one rule it keeps.');
  assert.deepEqual(named.filter((t) => !tables.includes(t)), [], 'A store src/operational.ts names that no longer exists: take it out.');
  assert.ok(read('src/pelago.ts').includes(`function ${RESTORE}(`), 'The restore path src/operational.ts names is in src/pelago.ts.');
});

// Whether a change applies, waits for a person or is refused is decided by the rules (src/rules.ts, decide) and
// nowhere else: a change is held only with the rule that held it, a setting is read only as the lift of a rule, and
// the server's policy only as the rules it lifts or adds.
test('every approval is decided by a rule', () => {
  const src = walk('src').filter((f) => f.endsWith('.ts'));
  const held = count(src, /append\(tx, this\.workspace, 'pending'/g);
  assert.deepEqual(held, { 'src/pelago.ts': 1 }, 'A change waits only where Archipelago.change holds it on the verdict of decide.');
  assert.deepEqual(count(src, /insert\s+into\s+proposal\s*\(/gi), { 'src/replay.ts': 1 }, 'The queue is projected from the pending stream, nowhere else.');
  assert.match(read('src/pelago.ts'), /verdict\.outcome === 'hold'/, 'Archipelago.change holds a change on the verdict of decide.');
  const lifts = count(src.filter((f) => f !== 'src/rules.ts' && f !== 'src/schema.ts'), /['"`](?:agent_changes|agent_code|agent_publish|agent_backups)['"`]/g);
  assert.deepEqual(lifts, {}, 'A setting lifts a rule a pack declared liftable: read it through src/rules.ts (decide, mayDo, liftsOn).');
  const policy = count(src.filter((f) => f !== 'src/rules.ts'), /\bpolicy\s*\[|['"]forbidden['"]|level\s*===/g);
  assert.deepEqual(policy, {}, "The server's policy is read only by the rules: what it lifts, and what it forbids (serverRules).");
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
const CYCLES: Record<string, number> = {};

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

// 10. How anything looks is a style on the map, never kernel code, the defaults included ("Where does style live?",
// decided by the owner 20 Oct 2026). The packs ship the defaults as style presets (StyleDef, src/styles.ts); the UI
// keeps the mechanism (layouts, renderers, CSS rules that read variables) and no values: no colours, no lengths, no
// numeric constants. Counted here as hex colours, CSS lengths and UPPER_CASE number constants, as of 20 Oct 2026.
const LOOKS_IN_KERNEL: Record<string, number> = {
  'ui/saved-views.js': 1,
  'ui/draw.html': 6,
  'ui/list.css': 2,
  'ui/pan-zoom.js': 1,
  'ui/public.css': 1,
  'ui/style.css': 17,
  'ui/token-ask.js': 1,
  'ui/week.js': 1,
};
const LOOKS = /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|ch|vh|vw)\b|^(?:export )?const [A-Z][A-Z0-9_]* = -?[\d.]/gm;

test('how things look lives in style presets, not in the kernel', () => {
  const files = walk('ui').filter((f) => /\.(js|css|html)$/.test(f) && !VENDORED.includes(f));
  assert.deepEqual(ratchet(count(files, LOOKS), LOOKS_IN_KERNEL), [], "Make it a style field, give it its value in a pack's style preset (packs/*/pack.json, styles), and read it from the style.");
});

// 11. Every picture is drawn by a drawing: code a pack ships, which the owner changes on the map and which runs in
// the sandbox (src/drawings.ts, ui/drawing.js), never a shape the kernel draws itself (the owner, 22 Oct 2026). The
// kernel keeps the frame every picture has. Counted here as the shapes the page still draws itself, as of 22 Oct
// 2026; a shape moved into a pack's drawing comes off its list, with its modules in ui/.
const KERNEL_SHAPES: Record<string, number> = {
  'ui/lens.js': 1, // list
};
const SHAPES = /(?:LENS_SHAPES|SHAPES) = \{([^}]*)\}/;

test('the kernel draws no shape of its own: each is a drawing a pack ships', () => {
  const counted = Object.fromEntries(['ui/lens.js', 'ui/doc-lens.js'].map((f) => [f, (SHAPES.exec(read(f))?.[1] ?? '').split(',').filter((s) => s.trim()).length]));
  assert.deepEqual(ratchet(counted, KERNEL_SHAPES), [], "Make the shape a drawing in a pack (pack.json drawings: its modules, entered at index.js, answering with marks), as packs/core/draw/architecture is.");
});

// 12. One name for each idea (docs/glossary.md; Rule 9 of the rework's target model, the owner, 23 Oct 2026). The
// words it retires are counted in what a person or agent reads: the prose strings of the UI and of the tool and view
// descriptions, leaving out comments, SQL, markup, `code spans` and "field" names. Frozen at what remains, 23 Oct 2026.
const RETIRED_WORDS: Record<string, number> = {};
const RETIRED = /\b(?:entit(?:y|ies)|relations?|knowledge graphs?|type packs?|pictures?|shapes?)\b/gi;

/** The string literals of a file, comments skipped. A template's `${...}` is kept in its string, to be blanked. */
function literals(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i < 1) break; continue; }
    if (c !== "'" && c !== '"' && c !== '`') continue;
    let j = i + 1, depth = 0;
    for (; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (c === '`' && text[j] === '$' && text[j + 1] === '{') { depth++; j++; continue; }
      if (depth && text[j] === '}') { depth--; continue; }
      if (!depth && (text[j] === c || (c !== '`' && text[j] === '\n'))) break;
    }
    out.push(text.slice(i + 1, j));
    i = j;
  }
  return out;
}
const prose = (s: string) =>
  s.replace(/\$\{[^}]*\}/g, ' ').replace(/\\?`[^`]*\\?`/g, ' ').replace(/"[a-z_]+"/g, ' ').replace(/<[^>]*>/g, ' ');
const isProse = (s: string) => (/[a-z] [a-z]/i.test(s) || /^[A-Z][a-z]/.test(s)) && !/\b(?:select|insert|update|delete)\b[\s\S]*\b(?:from|into|set|where)\b/i.test(s);

test('the UI and the tools use one name for each idea', () => {
  const files = [
    ...walk('ui').filter((f) => f.endsWith('.js') && !VENDORED.includes(f)),
    ...walk('src').filter((f) => /^src\/(?:tools|views|declared|[a-z-]+-tools)\.ts$/.test(f)),
  ];
  const counted = Object.fromEntries(
    files
      .map((f) => [f, literals(read(f)).map(prose).filter(isProse).reduce((n, s) => n + (s.match(RETIRED)?.length ?? 0), 0)] as const)
      .filter(([, n]) => n > 0),
  );
  assert.deepEqual(ratchet(counted, RETIRED_WORDS), [], 'Say it with the word docs/glossary.md gives: item, link, the map, pack, view, drawing.');
});

// 13. One way to read (Rule 6 of the rework's target model, the owner, 23 Oct 2026): every picture, view and agent
// read is a lens. A view the kernel answers with its own code is one src/operational.ts names, with what it reads
// instead of the work; every other is a view a pack declares, and the core pack's are lens presets, answered by the
// lens query (src/lens-presets.ts). A kernel view that is neither is refused.
test('every kernel view is a lens preset or named as operational', async () => {
  await import('../src/tools.ts'); // every module that adds a view of its own (src/sessions.ts adds story) is loaded
  const { VIEWS } = await import('../src/views.ts');
  const unnamed = Object.keys(VIEWS).filter((name) => !(name in VIEWS_OPERATIONAL));
  assert.deepEqual(unnamed, [], 'Make it a lens preset (packs/core/pack.json views, with lens), or a pack view, or name it in src/operational.ts with what it reads.');
  assert.deepEqual(Object.keys(VIEWS_OPERATIONAL).filter((name) => !(name in VIEWS)), [], 'A view src/operational.ts names that the kernel no longer answers: take it out.');
  const core = JSON.parse(read('packs/core/pack.json')) as { views?: { id: string; lens?: unknown }[] };
  assert.deepEqual((core.views ?? []).filter((v) => !v.lens).map((v) => v.id), [], 'The core pack carries no code: each of its views is a lens preset.');
  const presets = (core.views ?? []).map((v) => v.id.slice(v.id.indexOf('.') + 1));
  assert.deepEqual(presets.filter((name) => name in VIEWS), [], 'A kernel view of the same name hides the lens preset: one name, one view.');
});
