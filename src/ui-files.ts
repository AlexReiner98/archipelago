// The files the web UI is served from, by the path a browser asks for, and the addresses a page names them by.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';

/** The app's own modules, each a part of the page (ui/app.js imports them), served at /<name>.js. */
const APP_MODULES = ['base', 'words', 'body', 'forms', 'home', 'held', 'canvas', 'query-bar', 'find', 'draft', 'item', 'item-doc', 'item-links', 'screens', 'attention', 'nav', 'graph', 'graph-draw', 'lens', 'lens-base', 'list', 'style-code', 'pan-zoom', 'gate', 'proof', 'roadmap', 'live', 'settle', 'week', 'time', 'workspace', 'workspace-cards', 'model-card', 'connections-card', 'members-card', 'styles-card', 'theme', 'token-piece', 'token-ask', 'canvases', 'diagram', 'start', 'plan-card', 'doc-lens', 'marks', 'drawing', 'drag', 'drawing-tip', 'surface', 'replica'];

export const UI_FILES: Record<string, string> = {
  ...Object.fromEntries(APP_MODULES.map((m) => [`/${m}.js`, `${m}.js`])),
  '/': 'index.html',
  '/app.js': 'app.js',
  // The house style's lengths as a stylesheet, so the page is laid out before the workspace's style is read (src/styles.ts).
  '/layout.css': 'layout.css',
  '/style.css': 'style.css',
  '/shell.css': 'shell.css',
  '/flow.css': 'flow.css',
  '/diagram.css': 'diagram.css',
  '/list.css': 'list.css',
  '/public.js': 'public.js',
  '/public.css': 'public.css',
  '/doc.js': 'doc.js',
  '/doc.css': 'doc.css',
  '/doc-lens.css': 'doc-lens.css',
  '/packs.js': 'packs.js',
  // Where a style's own drawing code runs: a page of its own in a sandboxed frame, and what it starts with.
  '/draw.html': 'draw.html',
  '/draw.js': 'draw.js',
  // The projector's pure part, which the page runs on the facts it reads (ui/replica.js): served from the kernel's own file.
  '/project.js': 'project.js',
  // three.js as its authors build it (MIT), offered to a style's code; loaded only when one asks for it.
  '/three.js': 'three.module.min.js',
};

const UI_DIR = join(import.meta.dirname, '..', 'ui');
/** Files served to the page from the kernel's source, as the page names them: TypeScript of erasable syntax only, its types stripped. */
const FROM_SOURCE: Record<string, string> = { 'project.js': join(import.meta.dirname, 'project.ts') };
const pathOf = (f: string) => FROM_SOURCE[f] ?? join(UI_DIR, f);
const readText = async (f: string) => (FROM_SOURCE[f] ? stripTypeScriptTypes(await readFile(FROM_SOURCE[f], 'utf8')) : readFile(join(UI_DIR, f), 'utf8'));
/** The pages a browser opens, and so asks for again on every visit; read whole, with the files they name versioned. */
const PAGES = ['index.html', 'doc.html', 'public.html', 'draw.html'];
/** Made by the server from the packs, not read from a file: named as it is, and never kept. */
const MADE = new Set(['/layout.css']);

// Every file a page names is named at an address that carries the version of the UI as a whole (?v=), so a browser
// keeps it for a year and a second visit fetches only the page. The version is read off the files' contents, so it
// moves when one is saved, under the dev server as on a deploy; an address with a version that is not the current
// one is answered with what is current, and not kept.
const named = (path: string) => !MADE.has(path) && UI_FILES[path] !== undefined && path !== '/';
let held: { key: string; version: string; text: Map<string, string> } | undefined;

/** The UI as served now: its version, and each text file with the files it names versioned. */
async function current() {
  const files = [...new Set([...Object.values(UI_FILES).filter((f) => f !== 'layout.css'), ...PAGES])].sort();
  const stats = await Promise.all(files.map((f) => stat(pathOf(f)).then((s) => `${f}:${s.size}:${s.mtimeMs}`)));
  const key = stats.join('|');
  if (held?.key === key) return held;
  const raw = new Map(await Promise.all(files.map(async (f) => [f, await readText(f)] as const)));
  const hash = createHash('sha256');
  for (const [f, text] of raw) hash.update(f).update('\0').update(text).update('\0');
  const version = hash.digest('hex').slice(0, 12);
  const at = (path: string) => `${path}?v=${version}`;
  const text = new Map<string, string>();
  for (const [f, body] of raw) {
    if (f.endsWith('.html')) text.set(f, body.replace(/\b(href|src)="(\/[\w.-]+)"/g, (all, attr, path) => (named(path) ? `${attr}="${at(path)}"` : all)));
    else if (f.endsWith('.js') && f !== 'three.module.min.js')
      // An import of another of the UI's modules, or a quoted address of one of its files ('/draw.html').
      text.set(f, body.replace(/(\bfrom\s*|\bimport\s*\(\s*)?(['"])(\.?\/)([\w.-]+)\2/g, (all, imp, q, dot, name) => ((dot === '/' || imp) && named(`/${name}`) ? `${imp ?? ''}${q}${dot}${name}?v=${version}${q}` : all)));
    else text.set(f, body);
  }
  held = { key, version, text };
  return held;
}

/** The modules a page's scripts import, at once or when they run, each once: fetched together, not round by round. */
function reached(text: Map<string, string>, from: string[]): string[] {
  const seen = new Set<string>();
  const visit = (path: string) => {
    if (seen.has(path) || !named(path) || !path.endsWith('.js') || path === '/three.js') return;
    seen.add(path);
    for (const m of (text.get(UI_FILES[path]) ?? '').matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*)['"]\.?(\/[\w.-]+\.js)\?v=/g)) visit(m[1]);
  };
  from.forEach(visit);
  return [...seen].filter((path) => !from.includes(path));
}

/** A page of the UI as served now: what it names versioned, and what its scripts will import asked for at once. */
export async function uiPage(file: string): Promise<string> {
  const { version, text } = await current();
  const page = text.get(file)!;
  const scripts = [...page.matchAll(/<script[^>]*\bsrc="(\/[\w.-]+\.js)\?v=/g)].map((m) => m[1]);
  const preload = reached(text, scripts).map((path) => `<link rel="modulepreload" href="${path}?v=${version}" />`);
  return preload.length ? page.replace('</head>', `    ${preload.join('\n    ')}\n  </head>`) : page;
}

/** One file of the UI as served now, and whether the address asked for may be kept (it names the current version). */
export async function uiFile(file: string, version: string | null): Promise<{ body: string | Buffer; keep: boolean }> {
  const now = await current();
  const body = now.text.get(file) ?? (await readFile(join(UI_DIR, file)));
  return { body, keep: version === now.version };
}
