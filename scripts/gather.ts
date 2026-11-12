// The gather step (docs/kernel-packs.md, wave 3 "Gather"): every shim src/ keeps for a module moved into a pack is
// removed, every importer names the module at its own place, and the structure test's lists keyed by `src/<m>.ts` are
// re-keyed to that place with the same counts. Idempotent; rerun it after any merge.
//
//   node scripts/gather.ts [--dry-run] [--out <file.json>] [--verbose]
//
// A shim is the pure `export * from '../packs/<p>/kernel/<m>.ts'`, or an adapter (test/structure-kit.ts recognised
// both): it re-exports its module and adapts what took the map, building the pack's context when called. A caller of
// an adapted function that passes the map gets the adapter's own expression at the call, `kernelContext(l, '<pack>')`
// built there: the same context, made the same way, so nothing it reads or writes changes (callAs would send it through
// a service name most of these functions are not, and answer as another provider would). The kernel (src/ and the root
// packs' code) may never import a service pack's code: a kernel caller of a service module is a wave-7 cut, left as it
// is, and its shim is kept and listed (test/fixtures/gather-kept.json) until wave 7 cuts it.
//
// Nothing is inlined into a service pack's code, which reaches the kernel through its context alone: what it imports
// through a shim is named, to be put on its context by hand. A script run by path (`node src/<m>.ts`: server, deploy,
// backup, cli) keeps a tiny entry there that only runs the moved module (ENTRIES). The contract's history
// (docs/kernel-packs.md) is left as written. An entry of test/bypassing-rls.test.ts whose count went down is lowered.
// Last, every root's hash is pinned again (`npm run roots`).

import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const args = process.argv.slice(2);
const DRY = args.includes('--dry-run'), VERBOSE = args.includes('--verbose');
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : undefined;
const KEPT_FILE = 'test/fixtures/gather-kept.json', ROOT_IMPORTS = 'test/fixtures/root-imports.json';
const KERNEL_CONTEXT = 'packs/loader/kernel/kernel-context.ts';

/** A file's text with LF line ends; it is written back with the ends it had (crlf, below). */
const disk = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const raw = (p: string) => disk(p).replace(/\r\n/g, '\n');
const walk = (dir: string): string[] =>
  !existsSync(join(ROOT, dir)) ? [] : readdirSync(join(ROOT, dir)).flatMap((n) => {
    const p = `${dir}/${n}`;
    return n === 'node_modules' ? [] : statSync(join(ROOT, p)).isDirectory() ? walk(p) : [p];
  });
const stripped = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
const rel = (fromFile: string, to: string) => { const r = posix.relative(posix.dirname(fromFile), to); return r.startsWith('.') ? r : `./${r}`; };
const resolveSpec = (fromFile: string, spec: string) => posix.normalize(posix.join(posix.dirname(fromFile), spec));
const camel = (m: string) => m.replace(/[-.](\w)/g, (_, c: string) => c.toUpperCase());
const manifest = (p: string) => (existsSync(join(ROOT, `packs/${p}/pack.json`)) ? JSON.parse(raw(`packs/${p}/pack.json`)) : {}) as { kernel?: { trust?: string } };
const ROOTS = new Set(readdirSync(join(ROOT, 'packs')).filter((p) => manifest(p).kernel?.trust === 'root'));
const packOf = (path: string) => /^packs\/([\w-]+)\//.exec(path)?.[1];

// --- Balanced scanning: strings, templates and brackets, enough for this code base's own TypeScript. ---
/** The index of the bracket closing the one at `i`. */
function close(t: string, i: number): number {
  const stack: string[] = [];
  for (let j = i; j < t.length; j++) {
    const c = t[j];
    if (c === "'" || c === '"' || c === '`') { j = skipString(t, j); continue; }
    if (c === '/' && t[j + 1] === '/') { j = t.indexOf('\n', j); if (j < 0) return -1; continue; }
    if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) { stack.pop(); if (!stack.length) return j; }
  }
  return -1;
}
function skipString(t: string, i: number): number {
  const q = t[i];
  for (let j = i + 1; j < t.length; j++) {
    if (t[j] === '\\') { j++; continue; }
    if (q === '`' && t[j] === '$' && t[j + 1] === '{') { j = close(t, j + 1); continue; }
    if (t[j] === q) return j;
  }
  return t.length;
}
/** Split at top-level commas (brackets, strings, and type arguments between < and >). */
function splitTop(t: string): string[] {
  const out: string[] = [];
  let depth = 0, angle = 0, start = 0;
  for (let j = 0; j < t.length; j++) {
    const c = t[j];
    if (c === "'" || c === '"' || c === '`') { j = skipString(t, j); continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === '<') angle++;
    else if (c === '>' && t[j - 1] !== '=' && angle > 0) angle--;
    else if (c === ',' && depth === 0 && angle === 0) { out.push(t.slice(start, j).trim()); start = j + 1; }
  }
  const last = t.slice(start).trim();
  return last ? [...out, last] : out;
}

// --- The shims. ---
interface Param { name: string; rest: boolean; dflt?: string }
interface Adapted { params: Param[]; body: string }
interface Shim { path: string; to: string; pack: string; root: boolean; adapter: boolean; adapted: Map<string, Adapted>; manual: string[] }

const PURE = /^export \* from '\.\.\/(packs\/[\w-]+\/kernel\/[\w./-]+\.ts)';$/;
const valueTargets = (t: string) => [...t.matchAll(/(?:^|;)[ \t]*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]);
const dynamicTargets = (t: string) => [...t.matchAll(/\bimport\s*\(\s*'([^']+)'/g)].map((m) => m[1]);

function findShims(): Map<string, Shim> {
  const out = new Map<string, Shim>();
  for (const f of walk('src').filter((x) => x.endsWith('.ts'))) {
    const text = stripped(raw(f)), own = posix.basename(f);
    let to = PURE.exec(text)?.[1], adapter = false;
    if (!to) {
      const targets = valueTargets(text), ofOwn = (s: string) => /^\.\.\/packs\/[\w-]+\/kernel\/[^/]+$/.test(s) && posix.basename(s) === own;
      const dyn = dynamicTargets(text).every((s) => s === './kernel-context.ts' || s === `../${KERNEL_CONTEXT}`);
      if (!(targets.length && targets.every(ofOwn) && dyn)) continue;
      to = resolveSpec(f, targets[0]); adapter = true;
    }
    const pack = packOf(to)!;
    out.set(f, { path: f, to, pack, root: ROOTS.has(pack), adapter, ...(adapter ? parseAdapter(raw(f)) : { adapted: new Map(), manual: [] }) });
  }
  return out;
}

/** An adapter's `export const f = async (l, ...) => moved.f(await ctx(l), ...)`, each as a template to inline at a call. */
function parseAdapter(text: string): { adapted: Map<string, Adapted>; manual: string[] } {
  const helpers = new Map<string, { fn: string; id: string }>(); // ctx helper name -> how it makes the context, and the pack
  for (const m of text.matchAll(/const (\w+) = async \((\w+)[^)]*\) => \(await import\('[^']*kernel-context\.ts'\)\)\.(kernelContext|ownContext)\(\2, '([\w-]+)'\);/g)) helpers.set(m[1], { fn: m[3], id: m[4] });
  const locals = [...text.matchAll(/^(?:let|const) (\w+)/gm)].map((m) => m[1]).filter((n) => !helpers.has(n));
  const adapted = new Map<string, Adapted>(), manual: string[] = [];
  for (const m of text.matchAll(/^export (?:const|function|async function) (\w+)/gm)) {
    const name = m[1];
    const helper = helpers.get(name); // an exported ctx helper (share-tools, sessions): the context, made where it is asked
    if (helper) { adapted.set(name, { params: [{ name: 'l', rest: false }], body: `${helper.fn}(l, '${helper.id}')` }); continue; }
    let i = m.index + m[0].length;
    const head = /^ = (?:async )?/.exec(text.slice(i));
    if (!head || !/^export const/.test(m[0])) { manual.push(name); continue; }
    i += head[0].length;
    if (text[i] === '<') { let d = 0; for (; i < text.length; i++) { if (text[i] === '<') d++; else if (text[i] === '>' && text[i - 1] !== '=' && --d === 0) { i++; break; } } }
    if (text[i] !== '(') { manual.push(name); continue; }
    const end = close(text, i), params = splitTop(text.slice(i + 1, end));
    const arrow = arrowAt(text, end + 1);
    let j = arrow + 2;
    while (/\s/.test(text[j])) j++;
    if (text[j] === '{') { manual.push(name); continue; }
    let k = j;
    for (; k < text.length && text[k] !== ';'; k++) if ('([{'.includes(text[k])) k = close(text, k); else if ("'\"`".includes(text[k])) k = skipString(text, k);
    let body = text.slice(j, k).trim();
    for (const [h, { fn, id }] of helpers) body = body.replace(new RegExp(`await ${h}\\(([\\w.]+)\\)`, 'g'), `${fn}($1, '${id}')`);
    body = body.replace(/\(await import\('[^']*kernel-context\.ts'\)\)\.(kernelContext|ownContext)\(/g, '$1(').replace(/^\(await ([\s\S]*)\) as [^()]+$/, '$1');
    if (/\bawait\b|\bimport\(/.test(body) || locals.some((n) => new RegExp(`(?<![\\w$.])${n}(?![\\w$])`).test(body))) { manual.push(name); continue; }
    if (params.some((p) => !/^(?:\.\.\.)?\w+/.test(p))) { manual.push(name); continue; } // a destructured parameter
    adapted.set(name, { params: params.map(param), body });
  }
  return { adapted, manual };
}
function param(p: string): Param {
  const rest = p.startsWith('...'), name = /^(?:\.\.\.)?(\w+)/.exec(p)![1], eq = topEquals(p);
  return { name, rest, dflt: eq >= 0 ? p.slice(eq + 1).trim() : /^\w+\?/.test(p) ? 'undefined' : undefined };
}
/** The index of an arrow's `=>` after its parameters, past a return type. */
function arrowAt(t: string, from: number): number {
  let depth = 0;
  for (let j = from; j < t.length; j++) {
    const c = t[j];
    if ("'\"`".includes(c)) { j = skipString(t, j); continue; }
    if (c === '=' && t[j + 1] === '>' && depth === 0) return j;
    if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && t[j - 1] !== '=')) depth--;
  }
  return -1;
}
/** The index of a parameter's default `=`, not one of `=>`, `==`, or inside brackets. */
function topEquals(p: string): number {
  let depth = 0;
  for (let j = 0; j < p.length; j++) {
    const c = p[j];
    if ("'\"`".includes(c)) { j = skipString(p, j); continue; }
    if ('([{<'.includes(c)) depth++;
    else if (')]}'.includes(c) || (c === '>' && p[j - 1] !== '=')) depth--;
    else if (c === '=' && depth === 0 && p[j + 1] !== '>' && p[j + 1] !== '=' && p[j - 1] !== '=' && p[j - 1] !== '!') return j;
  }
  return -1;
}

/** The adapter's body with a call's arguments put in for its parameters. */
function inline(a: Adapted, alias: string, args: string[]): string | undefined {
  if (args.some((x) => x.startsWith('...'))) return undefined;
  const wrap = (x: string) => (/^[\w$.]+$|^'[^']*'$|^\d+$/.test(x) ? x : `(${x})`);
  const values = new Map<string, string>();
  a.params.forEach((p, n) => values.set(p.name, p.rest ? args.slice(n).join(', ') : args[n] !== undefined ? wrap(args[n]) : (p.dflt ?? 'undefined')));
  let body = a.body;
  const rest = a.params.find((p) => p.rest);
  if (rest && !values.get(rest.name)) body = body.replace(new RegExp(`,\\s*\\.\\.\\.${rest.name}\\b`), '');
  let out = '';
  for (let j = 0; j < body.length; j++) {
    const c = body[j];
    if (c === "'" || c === '"') { const e = skipString(body, j); out += body.slice(j, e + 1); j = e; continue; }
    const id = /^[A-Za-z_$][\w$]*/.exec(body.slice(j));
    const spread = body.slice(j - 3, j) === '...';
    if (id && (spread || !/[\w$.]/.test(body[j - 1] ?? ''))) {
      const w = id[0];
      if (spread && values.has(w)) out = out.slice(0, -3);
      out += w === 'moved' ? alias : values.has(w) ? values.get(w)! : w;
      j += w.length - 1;
      continue;
    }
    out += c;
  }
  return out;
}

// --- The importers. ---
const IMPORTER_DIRS = ['src', 'packs', 'test', 'scripts', 'examples'];
const isService = (f: string) => { const p = packOf(f); return !!p && !ROOTS.has(p) && /^packs\/[\w-]+\/kernel\//.test(f) && !f.endsWith('.test.ts'); };
const isKernel = (f: string, shims: Map<string, Shim>) =>
  (f.startsWith('src/') && !shims.has(f)) || (ROOTS.has(packOf(f) ?? '') && /^packs\/[\w-]+\/kernel\//.test(f) && !f.endsWith('.test.ts'));
/** Each place a file names a module: `import`/`export ... from`, bare and dynamic imports, `new URL(...)`. */
const SPEC = /((?:^|[;\n])[ \t]*(?:import|export)(\s+type\b)?[^;'"]*?\bfrom\s*)(['"])([^'"]+)\3|(\bimport\s*\(\s*)(['"])([^'"]+)\6|((?:^|[;\n])[ \t]*import\s*)(['"])([^'"]+)\9|(\bnew URL\(\s*)(['"])([^'"]+)\12/g;

interface Found { cuts: string[]; manual: string[]; rewritten: Map<string, number>; inlined: number; removed: string[]; kept: Record<string, string[]>; rekeyed: number; dropped: string[]; runs: string[]; lowered: string[] }

function plan(shims: Map<string, Shim>, found: Found) {
  // A kernel file that imports a service module as a value keeps that shim: a wave-7 cut. Repeat until no new one.
  const kept = new Map<string, Set<string>>();
  for (let grew = true; grew;) {
    grew = false;
    for (const f of IMPORTER_DIRS.flatMap(walk).filter((x) => /\.(ts|mjs|js)$/.test(x))) {
      if (!(isKernel(f, shims) || kept.has(f))) continue;
      for (const m of raw(f).matchAll(SPEC)) {
        const spec = m[4] ?? m[7] ?? m[10], type = !!m[2];
        if (!spec?.startsWith('.') || m[13] || type) continue;
        const s = shims.get(resolveSpec(f, spec));
        if (s && !s.root && !kept.get(s.path)?.has(f)) { kept.set(s.path, (kept.get(s.path) ?? new Set()).add(f)); grew = true; }
      }
    }
  }
  for (const [s, by] of kept) found.kept[s] = [...by].sort();
  return kept;
}

function rewriteFile(f: string, shims: Map<string, Shim>, kept: Map<string, Set<string>>, found: Found): string | undefined {
  const before = raw(f);
  const kernel = isKernel(f, shims) || kept.has(f);
  // A service pack's code calls the kernel through its context alone (rule 4): nothing is inlined there, and what it
  // still imports through a shim is named to be put on its context by hand.
  const service = isService(f);
  let n = 0, needsContext = false;
  const aliases: { local: string; s: Shim; ns: boolean }[] = [];
  const adapterAt = (spec: string) => { const s = spec.startsWith('.') ? shims.get(resolveSpec(f, spec)) : undefined; return s?.adapter && s.adapted.size && !(kernel && !s.root) && !service ? s : undefined; };
  // A dynamic import of an adapter: `const { a } = await import(...)` takes the module whole beside what it keeps, and
  // `(await import(...)).a(...)` is inlined where it stands.
  let text = before.replace(/\b(const|let)\s*\{([^}]*)\}\s*=\s*await import\(\s*'([^']+)'\s*\)/g, (all, decl: string, names: string, spec: string) => {
    const s = adapterAt(spec);
    if (!s) return all;
    const to = rel(f, s.to), keep: string[] = [];
    let adaptedHere = 0;
    for (const part of splitTop(names)) {
      const [, imported, local] = /^(\w+)(?:\s*:\s*(\w+))?$/.exec(part) ?? [];
      if (imported && s.adapted.has(imported)) { adaptedHere++; aliases.push({ local: local ?? imported, s: { ...s, adapted: new Map([[imported, s.adapted.get(imported)!]]) }, ns: false }); }
      else keep.push(part);
    }
    if (!adaptedHere) return all;
    n++;
    return [...(keep.length ? [`${decl} { ${keep.join(', ')} } = await import('${to}')`] : []), `const ${camel(posix.basename(s.to, '.ts'))}Pack = await import('${to}')`].join(';\n  ');
  });
  const CALLED = /\(await import\(\s*'([^']+)'\s*\)\)\.(\w+)\(/g;
  for (let m; (m = CALLED.exec(text));) {
    const s = adapterAt(m[1]), adapted = s?.adapted.get(m[2]);
    if (!s || !adapted) continue;
    const open = m.index + m[0].length - 1, end = close(text, open);
    const done = inline(adapted, `(await import('${rel(f, s.to)}'))`, splitTop(text.slice(open + 1, end)));
    if (!done) { found.manual.push(`${f}: a call of ${m[2]} (${s.path}) spreads its arguments`); continue; }
    text = text.slice(0, m.index) + done + text.slice(end + 1); n++; found.inlined++; needsContext = true;
    CALLED.lastIndex = m.index + done.length;
  }
  text = text.replace(SPEC, (all, sHead, type, q1, s1, dHead, q2, s2, bHead, q3, s3, uHead, q4, s4, offset: number) => {
    const spec = s1 ?? s2 ?? s3 ?? s4, head = sHead ?? dHead ?? bHead ?? uHead, q = q1 ?? q2 ?? q3 ?? q4;
    if (!spec.startsWith('.')) return all;
    const s = shims.get(resolveSpec(f, spec));
    if (!s) return all;
    if (kernel && !s.root && !type && !uHead) { found.cuts.push(`${f} -> ${s.path}`); return all; }
    const to = rel(f, s.to);
    n++;
    if (service && !type) { found.manual.push(`${f}: a service pack's code imports ${s.path}: put it on its context`); return `${head}${q}${to}${q}`; }
    if (!s.adapter || !s.adapted.size || type) return `${head}${q}${to}${q}`;
    if (dHead || bHead || uHead) { found.manual.push(`${f}: a dynamic import of adapter ${s.path}`); return `${head}${q}${to}${q}`; }
    const binding = head.replace(/^[;\n]?[ \t]*(?:import|export)\s*/, '').replace(/\s*from\s*$/, '').trim();
    if (/^export\b/.test(head.trim().replace(/^[;\n]/, ''))) { found.manual.push(`${f}: re-exports adapter ${s.path}`); return `${head}${q}${to}${q}`; }
    const ns = /^\*\s+as\s+(\w+)$/.exec(binding);
    if (ns) { aliases.push({ local: ns[1], s, ns: true }); return `${head}${q}${to}${q}`; }
    const names = /^\{([\s\S]*)\}$/.exec(binding)?.[1];
    if (!names) { found.manual.push(`${f}: imports ${s.path} as ${binding}`); return `${head}${q}${to}${q}`; }
    const keep: string[] = [];
    let adaptedHere = 0;
    for (const part of splitTop(names)) {
      const [, imported, local] = /^(?:type\s+)?(\w+)(?:\s+as\s+(\w+))?$/.exec(part) ?? [];
      if (imported && !part.startsWith('type') && s.adapted.has(imported)) { adaptedHere++; aliases.push({ local: local ?? imported, s: { ...s, adapted: new Map([[imported, s.adapted.get(imported)!]]) }, ns: false }); }
      else { keep.push(part); if (imported && s.manual.includes(imported)) found.manual.push(`${f}: uses ${imported} of adapter ${s.path}, adapted by hand`); }
    }
    const lead = head.slice(0, head.search(/import|export/));
    const statements = [
      ...(keep.length ? [`import { ${keep.join(', ')} } from ${q}${to}${q}`] : []),
      ...(adaptedHere ? [`import * as ${camel(posix.basename(s.to, '.ts'))}Pack from ${q}${to}${q}`] : []),
    ];
    void offset;
    return lead + statements.join(';\n');
  });
  // The adapted functions' calls, each with the adapter's expression in place.
  for (const a of aliases) {
    const alias = a.ns ? a.local : `${camel(posix.basename(a.s.to, '.ts'))}Pack`;
    for (const [name, adapted] of a.s.adapted) {
      const callee = a.ns ? `${a.local}\\.${name}` : a.local;
      const re = new RegExp(`(?<![\\w$.])${callee}\\s*\\(`, 'g');
      let out = '', at = 0;
      for (const m of text.matchAll(re)) {
        if (m.index < at) continue;
        const open = m.index + m[0].length - 1, end = close(text, open);
        const done = inline(adapted, alias, splitTop(text.slice(open + 1, end)));
        if (!done) { found.manual.push(`${f}: a call of ${name} (${a.s.path}) spreads its arguments`); continue; }
        out += text.slice(at, m.index) + done; at = end + 1; found.inlined++; needsContext = true;
      }
      text = out + text.slice(at);
      const left = [...codeOnly(text).matchAll(new RegExp(`(?<![\\w$.'"])${callee}(?![\\w$])(?!\\s*[(:])`, 'g'))].length;
      if (left) found.manual.push(`${f}: ${name} of ${a.s.path} is used ${left} time(s) as a value, not called`);
    }
  }
  // What the inlined calls make their context with, imported where it is not yet.
  const makers = ['kernelContext', 'ownContext'].filter((fn) => needsContext && new RegExp(`(?<![\\w$.])${fn}\\(`).test(codeOnly(text)) && !new RegExp(`\\bimport\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from\\b`).test(text));
  if (makers.length && f !== KERNEL_CONTEXT) {
    const last = [...text.matchAll(/^import\b[^;(]*;[ \t]*$/gm)].at(-1);
    const at = last ? last.index + last[0].length : 0;
    text = `${text.slice(0, at)}\nimport { ${makers.join(', ')} } from '${rel(f, KERNEL_CONTEXT)}';${text.slice(at)}`;
  }
  if (n) found.rewritten.set(f, n);
  return text === before ? undefined : text;
}

/** A file with its comments and quoted strings blanked, to find where a name is used as code. */
const codeOnly = (t: string) =>
  t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\])\/\/.*$/gm, '$1').replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');

// --- Paths named as text: repo-relative `src/<m>.ts` in tests and scripts, and `node src/<m>.ts` anywhere. ---
const KERNEL_ONLY = ['NAMES_PACKS', 'NAMES_PACK_TYPES', 'NAMES_SURFACES', 'NAMES_SESSION_ACTS', 'IMPORTS_PACKS', 'READS_KINDS', 'WRITES_ELSEWHERE', 'WHOLE_READS', 'CYCLES'];
function rekeyText(f: string, text: string, moved: Map<string, string>, found: Found): string {
  let out = text.replace(/(['"`])src\/([\w.-]+\.ts)\1/g, (all, q: string, m: string) => {
    const to = moved.get(`src/${m}`);
    if (!to) return all;
    found.rekeyed++;
    return `${q}${to}${q}`;
  });
  if (f === 'test/structure.test.ts') {
    for (const list of KERNEL_ONLY) {
      out = out.replace(new RegExp(`(const ${list}\\b[^=]*=\\s*\\{)([\\s\\S]*?)(\\n?\\};)`), (_all, a: string, body: string, z: string) =>
        a + body.replace(/\s*'(packs\/([\w-]+)\/[^']+)':\s*(?:\d+|\[[^\]]*\]),?/g, (e: string, path: string, pack: string) => {
          if (ROOTS.has(pack)) return e;
          found.dropped.push(`${list}: ${path} (a service pack's, outside the kernel's files)`);
          return '';
        }) + z);
    }
  }
  return out;
}
function runsByPath(text: string, removed: Map<string, string>, where: string, found: Found) {
  return text.replace(/(\bnode |["'(\s]\.\/)src\/([\w-]+)\.ts\b/g, (all, lead: string, m: string) => {
    const to = removed.get(`src/${m}.ts`);
    if (!to) return all;
    found.runs.push(`${where}: ${lead.trimStart()}src/${m}.ts -> ${to}`);
    return `${lead}${to}`;
  });
}

// --- Scripts run by path. A person or a deploy runs these as `node src/<m>.ts`; each keeps a tiny entry there whose
// only job is to run the moved module (its importers still name the module at its own place). ---
const ENTRY_HEAD = '// Run by path: `node src/%s.ts` (%s). Its only job is to run %s.\n';
const ENTRIES: Record<string, string> = {
  'src/server.ts': `${ENTRY_HEAD.replace('%s', 'server').replace('%s', "the hosted image's command until it runs src/boot.ts").replace('%s', 'the server as `node src/boot.ts` does')}\nimport { run } from './boot.ts';\n\nawait run();\n`,
  'src/deploy.ts': `${ENTRY_HEAD.replace('%s', 'deploy').replace('%s', 'npm run migrate, and the hosted deploy and staging scripts').replace('%s', 'the deploy, packs/identity/kernel/deploy.ts')}\nimport { deploy } from '../packs/identity/kernel/deploy.ts';\n\nawait deploy();\n`,
  'src/backup.ts': `${ENTRY_HEAD.replace('%s', 'backup').replace('%s', 'a restore, as docs/reference.md says').replace('%s', 'the restore command of packs/log/kernel/backup.ts')}\nimport { restoreCommand } from '../packs/log/kernel/backup.ts';\n\nawait restoreCommand(process.argv.slice(2));\n`,
  'src/cli.ts': `${ENTRY_HEAD.replace('%s', 'cli').replace('%s', 'npm run pelago, and the operator, as docs/reference.md and the Workspaces card say').replace('%s', 'the command line, packs/surface/kernel/cli.ts')}\nimport '../packs/surface/kernel/cli.ts';\n`,
};
/** The contract's history is not rewritten: it says what each wave did with the paths of its day (docs are edited by hand). */
const UNTOUCHED = new Set(['docs/kernel-packs.md']);

// --- Run. ---
const shims = findShims();
const found: Found = { cuts: [], manual: [], rewritten: new Map(), inlined: 0, removed: [], kept: {}, rekeyed: 0, dropped: [], runs: [], lowered: [] };
const kept = plan(shims, found);
const moved = new Map([...shims].map(([p, s]) => [p, s.to]));
const removable = new Map([...moved].filter(([p]) => !kept.has(p) && !(p in ENTRIES)));
const writes = new Map<string, string>();
for (const f of IMPORTER_DIRS.flatMap(walk).filter((x) => /\.(ts|mjs|js)$/.test(x) && !removable.has(x))) {
  const text = rewriteFile(f, shims, kept, found);
  if (text !== undefined) writes.set(f, text);
}
for (const f of walk('test').filter((x) => /\.(ts|mjs|js)$/.test(x)).concat(walk('scripts').filter((x) => x.endsWith('.ts') && x !== 'scripts/gather.ts'))) {
  const text = rekeyText(f, writes.get(f) ?? raw(f), moved, found);
  if (text !== (writes.get(f) ?? raw(f))) writes.set(f, text);
}
// The owed root imports, each side at its module's place; a kept shim stays as the import it still is.
if (existsSync(join(ROOT, ROOT_IMPORTS))) {
  const owed = (JSON.parse(raw(ROOT_IMPORTS)) as string[]).map((e) => e.split(' -> ')).map(([a, b]) => `${moved.get(a) ?? a} -> ${removable.get(b) ?? b}`);
  const next = `${JSON.stringify([...new Set(owed)].sort(), null, 2)}\n`;
  if (next.replace(/\r\n/g, '\n') !== raw(ROOT_IMPORTS).replace(/\r\n/g, '\n')) writes.set(ROOT_IMPORTS, next);
}
const keptJson = `${JSON.stringify(Object.fromEntries(Object.entries(found.kept).sort()), null, 2)}\n`;
const noneKept = !Object.keys(found.kept).length; // with none kept, the list goes
if (!noneKept && (!existsSync(join(ROOT, KEPT_FILE)) || raw(KEPT_FILE).replace(/\r\n/g, '\n') !== keptJson)) writes.set(KEPT_FILE, keptJson);
const TEXT = ['package.json', 'CLAUDE.md', 'README.md', ...walk('.github'), ...walk('docs'), ...walk('ui'), ...walk('packs'), ...walk('scripts'), ...walk('test')]
  .filter((f) => /\.(md|json|ya?ml|ts|js|mjs|html)$/.test(f) && f !== 'scripts/gather.ts' && !UNTOUCHED.has(f) && existsSync(join(ROOT, f)));
for (const f of TEXT) {
  const text = writes.get(f) ?? raw(f), next = runsByPath(text, removable, f, found);
  if (next !== text) writes.set(f, next);
}
for (const [f, text] of Object.entries(ENTRIES)) if (!existsSync(join(ROOT, f)) || raw(f) !== text) writes.set(f, text);
found.removed = [...removable.keys()];

// The reads past row-level security (test/bypassing-rls.test.ts), each file counted as it will be: an entry whose
// count went down with the gather is lowered (a call an adapter made for nothing), never raised.
const RLS = 'test/bypassing-rls.test.ts';
if (existsSync(join(ROOT, RLS))) {
  const final = (f: string) => (removable.has(f) ? '' : writes.get(f) ?? (existsSync(join(ROOT, f)) ? raw(f) : ''));
  const lower = (text: string, list: string, re: RegExp) => text.replace(new RegExp(`(const ${list}\\b[^=]*=\\s*\\{)([\\s\\S]*?)(\\};)`), (_a, a: string, body: string, z: string) =>
    a + body.replace(/(\n?[ \t]*)'([^']+)': (\d+),?([^\n]*)/g, (e: string, lead: string, path: string, n: string, rest: string) => {
      const now = final(path).match(re)?.length ?? 0;
      if (now >= Number(n)) return e;
      found.lowered.push(`${list} ${path}: ${n} -> ${now}`);
      return now ? `${lead}'${path}': ${now},${rest}` : '';
    }) + z);
  const text = writes.get(RLS) ?? raw(RLS);
  const next = lower(lower(text, 'CALLERS', /(?<!function )\bbypassingRls\(/g), 'WHOLE_DB', /\bdb\.whole\b/g);
  if (next !== text) writes.set(RLS, next);
}

const crlf = (f: string, text: string) => (existsSync(join(ROOT, f)) && disk(f).includes('\r\n') ? text.replace(/\n/g, '\r\n') : text);
if (!DRY) {
  for (const [f, text] of writes) writeFileSync(join(ROOT, f), crlf(f, text));
  for (const f of removable.keys()) unlinkSync(join(ROOT, f));
  if (noneKept && existsSync(join(ROOT, KEPT_FILE))) unlinkSync(join(ROOT, KEPT_FILE));
  // Every root's folder changed: pin the new hashes (packs/roots.json), as any change under a root's folder needs.
  const pinned = spawnSync('npm run roots', { cwd: ROOT, shell: true, encoding: 'utf8' });
  if (pinned.status !== 0) { console.error(pinned.stderr || pinned.stdout); process.exitCode = 1; }
}
const adapters = [...shims.values()].filter((s) => s.adapter);
const summary = {
  shims: shims.size, pure: shims.size - adapters.length, adapters: adapters.length,
  removed: removable.size, kept: kept.size, files_changed: writes.size, importers: found.rewritten.size,
  specifiers: [...found.rewritten.values()].reduce((a, b) => a + b, 0), calls_inlined: found.inlined,
  cuts: found.cuts.length, manual: found.manual.length, rekeyed: found.rekeyed, dropped: found.dropped.length, runs: found.runs.length, lowered: found.lowered.length,
};
console.log(`${DRY ? 'would gather' : 'gathered'}: ${JSON.stringify(summary)}`);
if (VERBOSE || DRY) {
  for (const [title, list] of [['wave-7 cuts (kernel -> service module, shim kept)', [...new Set(found.cuts)]], ['by hand', found.manual], ['dropped', found.dropped], ['run by path', found.runs], ['bypassing-rls lowered', found.lowered]] as const) {
    console.log(`\n${title} (${list.length}):`);
    for (const l of list) console.log(`  ${l}`);
  }
}
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, ...found, rewritten: Object.fromEntries(found.rewritten), adapters: Object.fromEntries(adapters.map((s) => [s.path, { adapted: [...s.adapted.keys()], manual: s.manual }])) }, null, 2));
