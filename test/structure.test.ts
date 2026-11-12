// The shape of the code, checked. Files stay small; the kernel names no pack; writes to items and relations go through one
// path; a pack reaches the kernel only through what it is handed; a pack's code is tested without a database; kernel modules
// import one way; the UI loads as modules; there are four dependencies; every picture is a drawing a pack ships; every view
// the kernel answers is a lens preset or named as operational; the page calls no more tools than it did; the canvas draws no
// depth; a drawing's modules are all in its list, a length in one is named, and a wired one keeps its layers and wires apart;
// a root pack needs only the roots before it. Each rule keeps a list of what already broke it when the rule was made (16 Oct
// 2026). An entry may only shrink, and goes once the rule is met: when you bring a number down, lower it here. Every module
// is read at its own place (test/structure-kit.ts); a list keyed by a path names it there (scripts/gather.ts re-keys them).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { MAP_TABLES, RESTORE, STORES, VIEWS_OPERATIONAL } from '../src/operational.ts';
import { spacing } from './spacing.ts';
import { codeFiles, count, counts, KEPT, KERNEL_PACKS, kernelFiles, LEFT, lines, type Owed, packIds, ratchet, read, ROOT, rootCode, rootPacks, serviceImports, srcCode, target, VENDORED, walk } from './structure-kit.ts';
import { rootImports } from './structure-roots.ts';
import { drawings, faultsOf, imported, LAYERS, owedLayer, pathOf, ranks, saysLayer, setOut, short, WIRED, WRITES } from './wired.ts';

const MAX_LINES = 500;

// 1. No file over 500 lines.
const LONG_FILES: Record<string, number> = {};

test(`no file is over ${MAX_LINES} lines`, () => {
  const counted = Object.fromEntries(codeFiles.map((f) => [f, lines(read(f))]));
  assert.deepEqual(ratchet(counted, LONG_FILES, MAX_LINES), [], 'Split the file into modules, each one thing.');
});

// 2. The kernel never names a pack's types or relations: it works from kinds and capabilities.
const NAMES_PACKS: Record<string, number> = {};

test('the kernel names no pack', () => {
  const ids = [...new Set([...packIds.filter((p) => !KERNEL_PACKS.includes(p) && !rootPacks.includes(p)), ...Object.keys(LEFT)])];
  const named = count(kernelFiles, new RegExp(`['"\`](?:${ids.join('|')})\\.[a-z_]+['"\`]`, 'g'));
  assert.deepEqual(ratchet(named, NAMES_PACKS), [], 'Ask the registry for a kind or a capability instead of naming a pack type.');
});

// A type or link type is named by what it is, not by its pack (decided 27 Oct 2026), so a pack's type is caught by its
// bare name too. What was counted on that day is words that are also some pack's type name (a capability, a view, a
// verb's action): no new one may be added. SQL strings count too (`type = 'run'`); run, works_on, notification, about are core's.
const NAMES_PACK_TYPES: Record<string, number> = {
  'src/altitude.ts': 1, 'src/capabilities.ts': 2, 'src/declared.ts': 3,
  'src/look-pass.ts': 1,
  'src/manifest.ts': 1, 'src/outside.ts': 1, 'src/packhost.ts': 4, 'src/packreads.ts': 1, 'src/packs.ts': 3, 'src/packtools.ts': 3, 'src/pelago.ts': 2, 'src/pg.ts': 1,
  'src/public-document.ts': 1, 'src/public.ts': 2, 'src/replay.ts': 1, 'src/rules.ts': 1, 'src/schema.ts': 1, 'src/scope.ts': 2,
  'src/session-hook.ts': 1, 'src/surface.ts': 2, 'src/tail.ts': 1, 'src/tool-reads.ts': 1, 'src/ui-files.ts': 1,
  'ui/canvas.js': 1, 'ui/doc.js': 5, 'ui/draft.js': 2, 'ui/item-doc.js': 1, 'ui/item.js': 2, 'ui/screens.js': 1, 'ui/workspace-cards.js': 1,
};

// Core's words until 11 Nov 2026 (people and calendar packs, e_wrdg6udh); `event` is also the kernel's for a log event.
const LEFT_CORE = ['company', 'works_at', 'event'];

test("the kernel names no pack's type by its bare name", () => {
  const ids = packIds.filter((p) => !KERNEL_PACKS.includes(p) && existsSync(join(ROOT, 'packs', p, 'pack.json'))).flatMap((p) => {
    const m = JSON.parse(read(`packs/${p}/pack.json`)) as { types?: { id?: string }[]; links?: { id: string }[] };
    return [...(m.types ?? []), ...(m.links ?? [])].flatMap((t) => (t.id && !LEFT_CORE.includes(t.id) ? [t.id] : []));
  }).concat(Object.values(LEFT).flat());
  const named = count(kernelFiles, new RegExp(`['"\`](?:${ids.join('|')})['"\`]`, 'g'));
  assert.deepEqual(ratchet(named, NAMES_PACK_TYPES), [], 'Ask the registry for a kind or a capability instead of naming a pack type.');
});

// Every part of the kernel becomes a pack (the owner, e_ykymc952). Until each moves, what the kernel
// still knows of it is listed with the step on the map that takes it away; an entry may only shrink.
const SESSIONS = 'e_xzwgetrg Sessions behaviour into its pack', VIEWS = 'e_8f8m2xtf Kernel views as packs';

// A surface is a pack that adapts a client's hooks or launches one (reach.server adapter or launchers), and the kernel
// names none of it: not `claude_code`, `claude-code`, `claude-headless`, nor the client `claude`.
const NAMES_SURFACES: Owed = {
  'ui/agents-card.js': [2, VIEWS], 'ui/connect-agent.js': [4, VIEWS], 'ui/words.js': [1, VIEWS],
};
test('the kernel names no surface', () => {
  const vendors = packIds.filter((p) => !KERNEL_PACKS.includes(p) && existsSync(join(ROOT, 'packs', p, 'pack.json'))).flatMap((p) => {
    const server = (JSON.parse(read(`packs/${p}/pack.json`)) as { reach?: { server?: { adapter?: unknown; launchers?: unknown[] } } }).reach?.server;
    return server?.adapter || server?.launchers?.length ? [p.split(/[_-]/)[0]] : [];
  });
  assert.ok(vendors.length, 'no pack declares a surface: this rule reads nothing');
  const named = count(kernelFiles, new RegExp(`['"\`](?:${vendors.join('|')})(?:[-_][a-z]+)*['"\`]`, 'g'));
  assert.deepEqual(ratchet(named, counts(NAMES_SURFACES)), [], 'Let the surface pack say it: its adapter, launcher or setup, read through the registry.');
});

// The sessions' actions, named here until the sessions pack declares them (e_xzwgetrg): the kernel switches on none.
const NAMES_SESSION_ACTS: Owed = {
  'src/views.ts': [1, SESSIONS], 'ui/item.js': [1, VIEWS],
};
test("the kernel names no session's action", () => {
  const named = count(kernelFiles, /['"`]session_(?:start|update|end)['"`]/g);
  assert.deepEqual(ratchet(named, counts(NAMES_SESSION_ACTS)), [], 'An action is its pack\'s: let the pack declare what it checks.');
});

// The kernel runs a pack's code only as the pack's, through the registry: it imports none from packs/ but the root packs'
// (its own code). A type-only import is erased and does not count. The shims src/ keeps for wave 7 (KEPT) are its debt.
const IMPORTS_PACKS: Owed = {};
test("the kernel imports no pack's code", () => {
  const named = Object.fromEntries(kernelFiles.filter((f) => !KEPT.has(f)).map((f) => [f, serviceImports(f)]).filter(([, n]) => (n as number) > 0));
  assert.deepEqual(ratchet(named, counts(IMPORTS_PACKS)), [], "Move the code that needs it into the pack, or hand the pack's answer in.");
});

// The kernel reads no kind (the owner, e_w46v6jf9): core's eight are starter types, and what an item is comes from its type
// (its starter, lineage, capabilities). The kind column is written from the starter, the `kind <k>` term read through the type;
// left: the database's own fill of the column, a released schema step that is never edited (src/head.ts, ITEM_KIND).
const READS_KINDS: Record<string, number> = { 'src/head.ts': 1 };
const KIND_READ = /\bkindsOf\b|\.kinds\(\)|\b(?:type|get)\([^)]*\)\??\.kind\b|\b(?:type|def|parent|resolved|item|entity)\??\.kind\b|\bkind\s*(?:[!=]==?|<>)\s*['"](?:actor|aim|work|question|record|occurrence|place|system)['"]|\be\.kind\s*(?:=|<>|!=)\s|def->>'kind'/g;
test('the kernel reads no kind', () => {
  assert.deepEqual(ratchet(count(kernelFiles, KIND_READ), READS_KINDS), [], "Read the type: its starter, its lineage (registry.isA) or a capability it declares, never an item's kind.");
});

// 3. Writes to items and relations go through the write path (src/pelago.ts, its apply loop in src/change-apply.ts):
// change for facts, projected by the projector it runs (src/replay.ts), and the operational writes and the restore path src/operational.ts names.
// Every other store is named there too.
const WRITES_ELSEWHERE: Record<string, number> = {};
const WRITE_PATH = ['src/pelago.ts', 'src/change-apply.ts', 'src/replay.ts'];

test('items and relations are written in one place', () => {
  const others = srcCode.filter((f) => !WRITE_PATH.includes(f));
  const writes = count(others, /\b(?:insert\s+into|update|delete\s+from)\s+(?:entity|relation)\b/gi);
  assert.deepEqual(ratchet(writes, WRITES_ELSEWHERE), [], 'Send the change through Archipelago.change.');
});

test('every store is named, with its rule', () => {
  const made = (re: RegExp) => new Set(srcCode.flatMap((f) => [...read(f).matchAll(re)].map((m) => m[1])));
  const tables = [...made(/create table if not exists (\w+)/gi)].filter((t) => !made(/drop table if exists (\w+)/gi).has(t)); // one a later step drops is no store
  const named = [...MAP_TABLES, ...Object.keys(STORES)];
  assert.deepEqual(tables.filter((t) => !named.includes(t)), [], 'Name the store in src/operational.ts, with the one rule it keeps.');
  assert.deepEqual(named.filter((t) => !tables.includes(t)), [], 'A store src/operational.ts names that no longer exists: take it out.');
  assert.ok(read('src/pelago.ts').includes(`function ${RESTORE}(`), 'The restore path src/operational.ts names is in src/pelago.ts.');
});

// Whether a change applies, waits for a person or is refused is decided by the rules (src/rules.ts, decide) and
// nowhere else: a change is held only with the rule that held it, a setting is read only as the lift of a rule, and
// the server's policy only as the rules it lifts or adds.
test('every approval is decided by a rule', () => {
  const src = srcCode;
  const held = count(src, /append\(tx, this\.workspace, 'pending'/g);
  assert.deepEqual(held, { 'src/pelago.ts': 1 }, 'A change waits only where Archipelago.change holds it on the verdict of decide.');
  assert.deepEqual(count(src, /insert\s+into\s+proposal\s*\(/gi), { 'src/replay.ts': 1 }, 'The queue is projected from the pending stream, nowhere else.');
  assert.match(read('src/pelago.ts'), /verdict\.outcome === 'hold'/, 'Archipelago.change holds a change on the verdict of decide.');
  const lifts = count(src.filter((f) => f !== 'src/rules.ts' && f !== 'src/schema.ts'), /['"`](?:agent_changes|agent_code|agent_publish|agent_backups)['"`]/g);
  assert.deepEqual(lifts, {}, 'A setting lifts a rule a pack declared liftable: read it through src/rules.ts (decide, mayDo, liftsOn).');
  const policy = count(src.filter((f) => f !== 'src/rules.ts'), /\bpolicy\s*\[|['"]forbidden['"]|level\s*===/g);
  assert.deepEqual(policy, {}, "The server's policy is read only by the rules: what it lifts, and what it forbids (serverRules).");
});

// 4. A pack's code imports only its own files and Node's built-ins, never the kernel's; its tests also #pelago/test, and a kernel pack's modules `import type` #pelago/kernel.
test("a pack's code imports nothing of the kernel", () => {
  const reaching: string[] = [];
  for (const file of walk('packs').filter((f) => /\.(ts|js|mjs)$/.test(f) && !rootCode.includes(f))) { const text = read(file); // a root's: rule 22
    for (const { 1: spec, index } of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)) {
      const own = spec.startsWith('./') || (spec.startsWith('../') && !relative(join(ROOT, 'packs', file.split('/')[1]), join(ROOT, file, '..', spec)).startsWith('..'));
      if (!own && !(spec === '#pelago/test' && /\.test\.ts$/.test(file)) && !(spec === '#pelago/kernel' && /^import\s+type\b/.test(text.slice(text.lastIndexOf('import', index), index))) && !spec.startsWith('node:')) reaching.push(`${file} imports ${spec}`);
    }
  }
  assert.deepEqual(reaching, [], 'A pack is handed what it reads and answers with ops and requests.');
});

// 5. A pack that carries code carries the tests of it, run without a database: input and what was
// read go in, ops and requests come out.
test("a pack's code comes with its tests", () => {
  const untested = packIds.filter((p) => !rootPacks.includes(p)).filter((p) => { // a root's tests stay in test/ in the wave
    const files = walk(`packs/${p}`);
    return files.some((f) => /\.(ts|js|mjs)$/.test(f) && !/\.test\./.test(f)) && !files.some((f) => /\.test\.(ts|js|mjs)$/.test(f));
  });
  assert.deepEqual(untested, [], 'Add a *.test.ts beside the handlers, fixtures in and ops out.');
});

// 6. Kernel modules import one way: no cycles. Type-only imports do not count.
const CYCLES: Record<string, number> = {};

test('kernel modules import one way', () => {
  // Each module by its path: since the gather a module imports another pack's at `../../<p>/kernel/<m>.ts`.
  const files = srcCode, known = new Set(files), edges = new Map(files.map((f) => [f, [] as string[]]));
  for (const f of files) {
    for (const [, spec] of read(f).matchAll(/(?:^|;)[ \t]*import\s+(?!type\b)[^;]*?from\s+'(\.{1,2}\/[^']+\.ts)'/gm)) if (known.has(target(f, spec))) edges.get(f)!.push(target(f, spec));
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
  // The sandboxed drawing frame has no origin of its own; a module there is untried. Its two halves (a style's code,
  // drawings that answer with marks) are one script split to stay under 500 lines (e_vbmkhnyb), not a second page's.
  'ui/draw.html: <script src="/draw-marks.js">': 1,
  'ui/draw.html: <script src="/draw.js">': 1,
};

test('the UI loads as modules', () => {
  const classic: Record<string, number> = {};
  for (const page of walk('ui').filter((f) => f.endsWith('.html'))) {
    for (const [tag] of read(page).matchAll(/<script\b[^>]*\bsrc=[^>]*>/g)) if (!/type="module"/.test(tag)) classic[`${page}: ${tag}`] = 1;
  }
  assert.deepEqual(ratchet(classic, CLASSIC_SCRIPTS), [], 'Load it with <script type="module"> and import what it needs.');
});

// 8. Four dependencies (CLAUDE.md); another only with the owner's agreement.
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
  'ui/draw.html': 6,
  'ui/public.css': 1,
  'ui/style.css': 8,
  'ui/token-ask.js': 1,
  'ui/week.js': 1,
};
const LOOKS = /#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|em|ch|vh|vw)\b|^(?:export )?const [A-Z][A-Z0-9_]* = -?[\d.]/gm;

test('how things look lives in style presets, not in the kernel', () => {
  const files = walk('ui').filter((f) => /\.(js|css|html)$/.test(f) && !VENDORED.includes(f));
  assert.deepEqual(ratchet(count(files, LOOKS), LOOKS_IN_KERNEL), [], "Make it a style field, give it its value in a pack's style preset (packs/*/pack.json, styles), and read it from the style.");
});

// 10b. No pills (the owner, 27 Oct 2026, rule e_vgs9vt5j): a state, a kind or a count is a word on the surface, its
// tone a colour (`.mark`), never a capsule. Counted as pill or chip classes and capsule radii; a key's `-chip` is a
// colour swatch, not a word, and the one left is the toggle switch's own track (ui/shell.css). Frozen 9 Nov 2026.
const CAPSULES: Record<string, number> = { 'ui/shell.css': 1 };
const CAPSULE = /(?:class(?:Name)?:\s*[`'"][^`'"]*?|\.)(?<![\w-])(?:pill|chip|[\w-]+-pill)(?![\w-])|999px|radius-pill/g;
test('no term or control is wrapped in a capsule', () => {
  const files = [...walk('ui'), ...walk('packs')].filter((f) => /\.(js|css|html)$/.test(f) && !VENDORED.includes(f));
  assert.deepEqual(ratchet(count(files, CAPSULE), CAPSULES), [], 'Draw it as a word with class mark and a tone (open, closed, ok, warn, bad): no background, padding or round ends.');
});

// 11. Every picture is drawn by a drawing: code a pack ships, which the owner changes on the map and which runs in
// the sandbox (src/layouts.ts, ui/layout.js), never a shape the kernel draws itself (the owner, 22 Oct 2026). The
// kernel keeps the frame every picture has. Counted here as the shapes the page still draws itself, as of 22 Oct
// 2026; a shape moved into a pack's drawing comes off its list, with its modules in ui/.
const KERNEL_SHAPES: Record<string, number> = {};
const SHAPES = /(?:LENS_SHAPES|SHAPES) = \{([^}]*)\}/;

test('the kernel draws no shape of its own: each is a drawing a pack ships', () => {
  const counted = Object.fromEntries(['ui/query.js', 'ui/doc-lens.js'].map((f) => [f, (SHAPES.exec(read(f))?.[1] ?? '').split(',').filter((s) => s.trim()).length]));
  assert.deepEqual(ratchet(counted, KERNEL_SHAPES), [], "Make the shape a drawing in a pack (pack.json drawings: its modules, entered at index.js, answering with marks), as packs/canvas/layouts/architecture is.");
});

// 12. One name for each idea (docs/glossary.md; Rule 9 of the rework's target model, the owner, 23 Oct 2026). The
// words it retires are counted in what a person or agent reads: the prose strings of the UI and of the tool and view
// descriptions, leaving out comments, SQL, markup, `code spans` and "field" names. Frozen at what remains, 23 Oct 2026.
const RETIRED_WORDS: Record<string, number> = {};
const RETIRED = /\b(?:entit(?:y|ies)|relations?|knowledge graphs?|type packs?|pictures?|shapes?)\b/gi;

/** The string literals of a file, comments skipped. A template's `${...}` is kept in its string, to be blanked. */
function scanned(text: string) {
  const out: string[] = [];
  let code = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') { i = text.indexOf('\n', i); if (i < 0) break; continue; }
    if (c === '/' && text[i + 1] === '*') { i = text.indexOf('*/', i + 2) + 1; if (i < 1) break; continue; }
    if (c !== "'" && c !== '"' && c !== '`') { code += c; continue; }
    let j = i + 1, depth = 0;
    for (; j < text.length; j++) {
      if (text[j] === '\\') { j++; continue; }
      if (c === '`' && text[j] === '$' && text[j + 1] === '{') { depth++; j++; continue; }
      if (depth && text[j] === '}') { depth--; continue; }
      if (!depth && (text[j] === c || (c !== '`' && text[j] === '\n'))) break;
    }
    out.push(text.slice(i + 1, j));
    code += ` ${(out.at(-1)!.match(/\$\{[^}]*\}/g) ?? []).join(' ').replace(/[${}]/g, ' ')} `;
    i = j;
  }
  return { strings: out, code };
}
const literals = (text: string) => scanned(text).strings;
const prose = (s: string) =>
  s.replace(/\$\{[^}]*\}/g, ' ').replace(/\\?`[^`]*\\?`/g, ' ').replace(/"[a-z_]+"/g, ' ').replace(/<[^>]*>/g, ' ');
const isProse = (s: string) => (/[a-z] [a-z]/i.test(s) || /^[A-Z][a-z]/.test(s)) && !/\b(?:select|insert|update|delete)\b[\s\S]*\b(?:from|into|set|where)\b/i.test(s);

test('the UI and the tools use one name for each idea', () => {
  const files = [
    ...walk('ui').filter((f) => f.endsWith('.js') && !VENDORED.includes(f)),
    ...[...walk('src'), ...walk('packs')].filter((f) => /^(?:src|packs\/[\w-]+\/kernel)\/(?:tools|views|declared|[a-z-]+-tools)\.ts$/.test(f)),
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
// lens query (src/query-presets.ts). A kernel view that is neither is refused.
test('every kernel view is a lens preset or named as operational', async () => {
  await import('../src/tools.ts'); // every module that adds a view of its own (src/sessions.ts adds story) is loaded
  const { VIEWS } = await import('../src/views.ts');
  const unnamed = Object.keys(VIEWS).filter((name) => !(name in VIEWS_OPERATIONAL));
  assert.deepEqual(unnamed, [], 'Make it a lens preset (packs/core/pack.json views, with lens), or a pack view, or name it in src/operational.ts with what it reads.');
  assert.deepEqual(Object.keys(VIEWS_OPERATIONAL).filter((name) => !(name in VIEWS)), [], 'A view src/operational.ts names that the kernel no longer answers: take it out.');
  const core = JSON.parse(read('packs/core/pack.json')) as { views?: { id: string; lens?: unknown; form?: string }[] };
  const reads = (core.views ?? []).filter((v) => !v.form);
  assert.deepEqual(reads.filter((v) => !v.lens).map((v) => v.id), [], 'The core pack carries no code: each of its views is a lens preset.');
  const presets = reads.map((v) => v.id.slice(v.id.indexOf('.') + 1));
  assert.deepEqual(presets.filter((name) => name in VIEWS), [], 'A kernel view of the same name hides the lens preset: one name, one view.');
});

// 14. A small pack manifest (Rule 8 of the target model): a pack file says what it declares in the manifest's keys
// (src/manifest.ts), and nothing else. A key of the shape before is one LEGACY maps, refused with where it went;
// here no pack file uses one. A key that is neither is refused.
test('every pack file is in the manifest shape, and every old key is mapped', async () => {
  const { LEGACY, MANIFEST_KEYS, REACH_KEYS, SERVER_KEYS } = await import('../src/manifest.ts');
  const unmapped: string[] = [];
  for (const file of [...walk('packs'), ...walk('test'), ...walk('examples')].filter((f) => f.endsWith('/pack.json'))) {
    const m = JSON.parse(read(file)) as Record<string, unknown> & { reach?: Record<string, unknown> & { server?: Record<string, unknown> } };
    const out = (where: string, given: Record<string, unknown> | undefined, keys: readonly string[]) => Object.keys(given ?? {}).filter((k) => !keys.includes(k)).map((k) => `${file}: ${where}${k}${k in LEGACY ? ` (now ${LEGACY[k]})` : ''}`);
    unmapped.push(...out('', m, MANIFEST_KEYS), ...out('reach.', m.reach, REACH_KEYS), ...out('reach.server.', m.reach?.server, SERVER_KEYS));
  }
  assert.deepEqual(unmapped, [], 'Write it in the manifest shape (docs/packs.md): a key the manifest does not have is refused.');
  const lands = (to: string) => to.startsWith('nothing') || [...MANIFEST_KEYS, 'reach.server'].some((k) => to === k || to.startsWith(`${k} `) || to.startsWith(`${k}.`)) || REACH_KEYS.some((k) => to.startsWith(`reach.${k}`));
  assert.deepEqual(Object.entries(LEGACY).filter(([, to]) => !lands(to)).map(([k]) => k), [], 'Every old key says the manifest key it is read as, or that it goes.');
});

// 15. No read of the whole map ("Refuse unscoped reads", 24 Oct 2026). At millions of items a query of the items,
// links, log or queue with nothing to bound it reads them all: each is bounded by an id or a set of them, a subtree
// (the part_of closure), a person, a time or place in the log, or a limit; or names the index it goes by
// (`-- index <name>`), one the schema makes (src/read-indexes.ts has those made for it). What already broke it on 24 Oct is listed, and may only shrink.
const WHOLE_READS: Record<string, number> = {
  'src/forget.ts': 2,
  'src/log.ts': 2,
  'src/mentions.ts': 1,
  'src/pelago.ts': 1,
  'src/search.ts': 1,
  'src/server.ts': 1,
  'src/streams.ts': 1,
};

/** The tables that grow with the map. */
const GROWS = /\b(?:from|join)\s+(?:entity|relation|event|log_entry|log_fact|log_op|proposal)\b(?!\s*\()/i;
/** What bounds a read. */
const BOUND = /=\s*any\s*\(|unnest\s*\(|\b(?:id|from_id|to_id|target_id|ancestor|descendant|owner|changeset|undoes)\s*=\s*(?:\$|[a-z_]+\b(?!\s*\())|\bid\s+in\s*\(\s*select|\blimit\s+(?:\$|\d|\$\{)|\b(?:seq|pos|ts|at)\s*(?:>=?|=)\s*\$|--\s*index\s+[a-z_]+/i;

test('no read of the whole map', () => {
  const indexes = new Set(srcCode.flatMap((f) => [...read(f).matchAll(/create (?:unique )?index if not exists (\w+)/g)].map((m) => m[1])));
  const queries = (text: string) => [...text.matchAll(/`(?:[^`\\]|\\.)*`/gs)].map((m) => m[0]).filter((q) => /\bselect\b/i.test(q) && GROWS.test(q));
  const files = srcCode.filter((f) => f !== 'src/read-indexes.ts');
  const named = files.flatMap((f) => queries(read(f)).flatMap((q) => [...q.matchAll(/--\s*index\s+([a-z_, ]+)/g)].flatMap((m) => m[1].split(',').map((n) => n.trim()).filter(Boolean)))).filter((name) => !indexes.has(name));
  assert.deepEqual(named, [], 'A read names an index the schema makes.');
  const counted = Object.fromEntries(files.map((f) => [f, queries(read(f)).filter((q) => !BOUND.test(q)).length]).filter(([, n]) => (n as number) > 0));
  assert.deepEqual(ratchet(counted, WHOLE_READS), [], 'Bound the read: by an id, a subtree (part_closure), a person, a time or a limit; or name the index it goes by (-- index <name>).');
});

// 16. The page's surface is the agents' (the flat canvas, 25 Oct 2026; docs/canvas.md): a canvas is read as a lens
// (`view`), kept current from the log (`tail`) and written through `change`, the tools an agent calls. Every other tool
// the page calls through /api is one more way in that an agent does not share, so the names it calls are frozen as
// they stood on 25 Oct 2026, and may only go: a name the page stops calling comes off this list. A tool a pack's
// screen names (ui/screens.js calls it by the name its pack declares) is the pack's, and is not counted. `undo`, one of
// the agents' ten tools, came on 2 Nov 2026 at the owner's word: the page takes a change back as an agent does.
const PAGE_CALLS = [
  'backup_download', 'change', 'connections', 'decide', 'document', 'events', 'get', 'import_backup', 'init',
  'launch', 'member_add', 'member_list', 'member_set', 'pack_set', 'packs', 'picture',
  'proposals', 'publish', 'publish_all', 'publish_plan', 'published', 'schema', 'search', 'server_packs',
  'session_end', 'share_create', 'share_list', 'share_plan', 'share_revoke', 'tail',
  'time_invoice_draft', 'time_invoice_paid', 'time_log', 'time_timesheet', 'time_week', 'token_create', 'token_list',
  'token_request_answer', 'token_requests', 'token_revoke', 'undo', 'unpublish', 'view', 'workspace_info', 'workspace_set',
];

test('the page calls no more tools through /api than it did', () => {
  const files = walk('ui').filter((f) => f.endsWith('.js') && !VENDORED.includes(f));
  const called = new Set(files.flatMap((f) => [...read(f).matchAll(/\bapi\(\s*['"`]([a-z_]+)['"`]/g)].map((m) => m[1])));
  const counted = Object.fromEntries([...called].map((name) => [name, 1]));
  assert.deepEqual(ratchet(counted, Object.fromEntries(PAGE_CALLS.map((name) => [name, 1]))), [], 'Read through a lens (view), keep it current with tail, write through change: what an agent calls.');
});

// 17. Depth is never drawn on the canvas (decision e_ktdensts): the flat lens answers items and links with nothing of
// what is inside what, and the canvas asks for no nesting of its picture (flatView's `nest` is for a kept view drawn in
// a document or a screen). Places are never kept (the owner, 3 Nov 2026): a view is drawn from its query alone, so
// nothing reads or appends to the places stream, which stays only so entries from before still read.
test('the canvas draws no depth, and nothing keeps places', () => {
  assert.doesNotMatch(read('ui/canvas.js'), /\bnest\s*:/, 'The canvas draws a flat lens flat: part_of is a tie, never a box inside a box.');
  assert.doesNotMatch(read('src/query-flat.ts').replace(/\/\/.*$/gm, ''), /\b(?:depth|places?)\b|\binside\s*:/, 'The flat lens answers items and links: no containment and no places.');
  const keepers = srcCode.filter((f) => /(?:readOps|record)\([^)]*'places'/.test(read(f)));
  assert.deepEqual(keepers, [], 'Nothing keeps where a person put a thing: a view is drawn from its query alone; grouping that matters is a link.');
});

// 18. A drawing's modules (docs/layouts.md): what it imports is in its list in pack.json, the only files the page is sent.
// A test imports files directly, so a module left off passes every test and stops the drawing on the page.

test("a drawing's list holds every module it reaches", () => {
  const missing: string[] = [];
  for (const d of drawings) {
    const seen = new Set<string>(), go = (name: string, from: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      if (!d.modules[name] || !existsSync(join(ROOT, pathOf(d, name)))) return void missing.push(`${d.id}: ${name}, from ${from}`);
      for (const next of imported(read(pathOf(d, name)))) go(next, name);
    };
    go('index.js', 'pack.json');
  }
  assert.deepEqual(missing, [], "Add the module to the drawing's modules in pack.json: the page is sent only what is listed.");
});

// 19. A number in a drawing is a length until shown otherwise, and a length is a size on the style, named, used on both
// axes (design e_49yk2trw). Counted, as of 30 Oct 2026: a bare number of 3 or more that does not multiply or divide
// (under 3 is arithmetic), and every px in a string. It catches more than lengths, and only ever goes down.
const LENGTHS_IN_DRAWINGS: Record<string, number> = {
  'flow/direction.js': 1, 'flow/index.js': 13, 'flow/numbering.js': 5, 'flow/planar.js': 1,
  'flow/shapes.js': 9, 'flow/thread.js': 3, 'flow/topology.js': 1, 'flow/upward.js': 4,
};
const BARE = /(?<![\w.$#])\d+(?:\.\d+)?(?![\w.])/g;

function lengthsIn(text: string) {
  const { strings, code } = scanned(text);
  const bare = [...code.matchAll(BARE)].filter((m) => Number(m[0]) >= 3 && !/(?:[*/%[]|>>)\s*$/.test(code.slice(Math.max(0, m.index - 3), m.index)) && !/^\s*[*/%]/.test(code.slice(m.index + m[0].length, m.index + m[0].length + 3)));
  return bare.length + strings.join(' ').split(/\b\d+(?:\.\d+)?px\b/).length - 1;
}

test('a length in a drawing is named on the style', () => {
  const files = packIds.flatMap((p) => walk(`packs/${p}/layouts`)).filter((f) => f.endsWith('.js'));
  const counted = Object.fromEntries(files.map((f) => [short(f), lengthsIn(read(f))]).filter(([, n]) => (n as number) > 0));
  assert.deepEqual(ratchet(counted, LENGTHS_IN_DRAWINGS), [], 'Name it: a size in the style (packs/canvas/pack.json), read from there, as the flow reads flow_wire_gap.');
});

// 20. A wired drawing is layers, each reading those before it (docs/layouts.md; design e_49yk2trw, 30 Oct 2026). A module
// says its layer in its first comment ("Layer: metrics."); LAYERS_OWED (test/wired.ts) is what those that do not yet say so
// will say, read as if they did, so the rules hold of them today, and a name goes from it as its module says it.
// LAYERS_MIXED are modules that are more than one layer. Each list here may only shrink, LAYERS_OWED too.
const LAYERS_MIXED: Record<string, number> = {}, LAYER_IMPORTS: Record<string, number> = {}, WRITERS: Record<string, number> = {};
const wired = drawings.filter((d) => d.id in WIRED), wiredFiles = [...new Set(wired.flatMap((d) => Object.keys(d.modules).map((name) => pathOf(d, name))))];

test('each module of a wired drawing names its layer', () => {
  assert.deepEqual(wiredFiles.filter((f) => !saysLayer(f) && !owedLayer(f)).map(short), [], 'Say its layer in its first comment: "Layer: graph.", topology, shape, metrics or marks (docs/layouts.md).');
  assert.deepEqual(wiredFiles.filter((f) => saysLayer(f) && owedLayer(f)).map(short), [], 'It says its layer now: take it off LAYERS_OWED.');
  const mixed = Object.fromEntries(wiredFiles.filter((f) => ranks(f).length > 1).map((f) => [short(f), 1]));
  assert.deepEqual(ratchet(mixed, LAYERS_MIXED), [], 'A module is one layer: split it, and each part says its own.');
});

test('a layer of a wired drawing reads only those before it', () => {
  const against: Record<string, number> = {};
  for (const d of wired) for (const name of Object.keys(d.modules)) for (const next of imported(read(pathOf(d, name)))) {
    if (Math.min(...ranks(pathOf(d, next))) > Math.max(...ranks(pathOf(d, name)))) against[`${short(pathOf(d, name))} -> ${short(pathOf(d, next))}`] = 1;
  }
  assert.deepEqual(ratchet(against, LAYER_IMPORTS), [], 'Hand the later layer what it needs, or move what both read to the earlier one.');
});
test("only Metrics sets a place or a wire's points", () => {
  const others = wiredFiles.filter((f) => !ranks(f).includes(LAYERS.indexOf('metrics')));
  const counted = Object.fromEntries(others.map((f) => [short(f), scanned(read(f)).code.match(WRITES)?.length ?? 0]).filter(([, n]) => (n as number) > 0));
  assert.deepEqual(ratchet(counted, WRITERS), [], 'Coordinates are output: Metrics sets them, from what this layer says.');
});
// 21. Sealed: each wired drawing runs on small sketches (test/wired.ts), and no two wires of it lie on one line, none stands
// under the spacing, no box stands on a box, none runs through a box. The spacing is the flow's (test/spacing.ts).
// Counted for the map as it stood when it became the one layout, 9 Nov 2026; each count may only go down.
// The map's trunks (one wire for the links of one type and one way off a box) are what share: wires of one box.
const NOT_SEALED: Record<string, number> = { 'core.map knot: shared': 1, 'core.map fan: shared': 24, 'core.map crossed: shared': 3, 'core.map comb: shared': 31 };
test('a wired drawing keeps its wires apart', async () => {
  const counted: Record<string, number> = {};
  for (const d of wired) {
    const found = await setOut(d, async (url) => faultsOf(WIRED[d.id], (await import(url('layout.js'))).layout, spacing));
    for (const [what, n] of Object.entries(found)) counted[`${d.id} ${what}`] = n;
  }
  assert.deepEqual(ratchet(counted, NOT_SEALED), [], `Wires take room in the solve: each stretch keeps its distance from every other (docs/layouts.md). Now: ${JSON.stringify(counted)}`);
});
// 22. A root imports plumbing, its own pack and the roots before it; what it imported above them is owed (structure-roots.ts).
test("a root pack's code imports only plumbing and the roots before it", () => {
  const owed = new Set(JSON.parse(read('test/fixtures/root-imports.json')) as string[]), added = rootImports().filter((e) => !owed.has(e));
  assert.deepEqual(added, [], 'Open a slot the higher pack fills, or hand the value in (docs/kernel-packs.md, "Slots").');
});
// 23. A service name is answered as the map that asks it (callAs, src/kernel-context.ts): callService ran its provider as the map the names were filled for, and is gone (wave 6); none comes back.
const CALLS_SERVICE: Record<string, number> = {}, servicePacks = walk('packs').filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
test('a service name is answered as the map that asks it', () => assert.deepEqual(ratchet(count([...kernelFiles, ...servicePacks], /(?<!function )\bcallService\s*[<(]/g), CALLS_SERVICE), [], 'Call it with callAs(l, name, input): its provider reads as the asker, under row-level security.'));
