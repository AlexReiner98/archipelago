// The files the web UI is served from, by the path a browser asks for, and the addresses a page names them by.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';

/** The app's own modules, each a part of the page (ui/app.js imports them), served at /<name>.js. */
const APP_MODULES = ['doc-ref', 'base', 'words', 'body', 'home', 'held', 'held-card', 'item-held', 'canvas', 'pinch', 'query-bar', 'find', 'find-choices', 'menu-place', 'draft', 'note-count', 'item', 'item-doc', 'item-read', 'item-links', 'link-pick', 'keep-in-view', 'item-sections', 'page-schema', 'screens', 'nav', 'query', 'query-base', 'style-code', 'pan-zoom', 'style-number', 'live', 'settle', 'workspace', 'workspace-cards', 'workspaces-card', 'connections-card', 'members-card', 'styles-card', 'themes-card', 'agents-card', 'connect-agent', 'plates', 'theme', 'token-piece', 'token-ask', 'canvases', 'diagram', 'start', 'limits-card', 'doc-lens', 'doc-sheet', 'marks', 'marks-add', 'reader-frame', 'view-frame', 'sheet-follow', 'layout', 'layout-asks', 'island-new', 'layout-tip', 'tip', 'surface', 'replica', 'membership', 'changes', 'traces', 'catch-up', 'catch-up-steps', 'thumbs', 'thumb-keep', 'thumb-still', 'ghosts', 'canvas-wires', 'authorize', 'password', 'text', 'fields', 'field-edit', 'look', 'look-marks', 'panes', 'pane-drag', 'pane-route', 'pane-busy', 'pane-address', 'tabs', 'tab-bar', 'tab-count', 'tab-life', 'pane-land', 'item-link', 'pane-web', 'picker-rank', 'term-pick', 'look-switch', 'view-panel', 'canvas-menu', 'only-words', 'term-kinds', 'way-back', 'part-bridge', 'part-going', 'part-host', 'part-check', 'part-render', 'part-paint', 'dom'];

export const UI_FILES: Record<string, string> = {
  ...Object.fromEntries(APP_MODULES.map((m) => [`/${m}.js`, `${m}.js`])),
  '/': 'index.html',
  '/app.js': 'app.js',
  // The reads every page waits on, asked as it starts, before its modules have loaded (packs/surface/page/base.js takes them).
  '/early.js': 'early.js',
  // The house style's lengths as a stylesheet, so the page is laid out before the workspace's style is read (packs/styles/kernel/styles.ts).
  '/layout.css': 'layout.css',
  '/style.css': 'style.css',
  '/shell.css': 'shell.css',
  '/flow.css': 'flow.css',
  '/diagram.css': 'diagram.css',
  '/notes.css': 'notes.css',
  '/story.css': 'story.css',
  '/menus.css': 'menus.css',
  // How a part's marks look: classes and steps the style gives values to (packs/walls/page/part-render.js).
  '/part-marks.css': 'part-marks.css',
  '/public.js': 'public.js',
  '/public.css': 'public.css',
  '/doc.js': 'doc.js',
  '/doc.css': 'doc.css',
  '/doc-lens.css': 'doc-lens.css',
  '/packs.js': 'packs.js',
  '/query-light.js': 'query-light.js',
  '/lit-by.js': 'lit-by.js',
  // A scene mounted again moves into place, its marks matched by key (packs/walls/page/layout.js mounts, ui/transition.js plays).
  '/transition.js': 'transition.js',
  // Where a style's own drawing code runs: a page of its own in a sandboxed frame, and what it starts with.
  '/draw.html': 'draw.html',
  '/draw.js': 'draw.js',
  '/draw-marks.js': 'draw-marks.js',
  // What runs in a drawing's worker: written in front of draw-marks.js, and into a drawing's service worker (drawInside).
  '/draw-inside.js': 'draw-inside.js',
  // The projector's pure part, which the page runs on the facts it reads (packs/surface/page/replica.js): served from the log pack's own file.
  '/project.js': 'project.js',
  // What a stylesheet from the map may say, which the page checks a sheet by and the server checks page_css by on write.
  '/css-check.js': 'css-check.js',
  // three.js as its authors build it (MIT), offered to a layout's code; loaded only when one asks for it.
  '/three.js': 'three.module.min.js',
};

const PACKS = join(import.meta.dirname, '..', '..');
const UI_DIR = join(PACKS, '..', 'ui');
/**
 * Where the files are: the app's, in ui/, and the host's, in each root pack's page/ (packs/roots.json), where its hash
 * keeps them. A file is served by its name alone, whichever folder holds it, so a name is in one folder only.
 */
export const UI_DIRS = [UI_DIR, ...(JSON.parse(readFileSync(join(PACKS, 'roots.json'), 'utf8')) as { roots: { id: string }[] }).roots.map((r) => join(PACKS, r.id, 'page')).filter((d) => existsSync(d))];
const DIR_OF = new Map<string, string>();
for (const dir of UI_DIRS)
  for (const f of readdirSync(dir)) {
    if (DIR_OF.has(f)) throw new Error(`${f} is in both ${DIR_OF.get(f)} and ${dir}: a file of the UI is served by its name, so it is in one folder.`);
    DIR_OF.set(f, dir);
  }
/** Files served to the page from the kernel's source, as the page names them: TypeScript of erasable syntax only, its types stripped. */
const FROM_SOURCE: Record<string, string> = { 'project.js': join(PACKS, 'log', 'kernel', 'project.ts'), 'css-check.js': join(PACKS, 'walls', 'kernel', 'css-check.ts') };
const pathOf = (f: string) => FROM_SOURCE[f] ?? join(DIR_OF.get(f) ?? UI_DIR, f);
const readText = async (f: string) => (FROM_SOURCE[f] ? stripTypeScriptTypes(await readFile(FROM_SOURCE[f], 'utf8')) : readFile(pathOf(f), 'utf8'));
/** The pages a browser opens, and so asks for again on every visit; read whole, with the files they name versioned. */
const PAGES = ['index.html', 'doc.html', 'public.html', 'draw.html'];
/** Made by the server from the packs, not read from a file: named as it is, and never kept. */
const MADE = new Set(['/layout.css']);

// Every file a page names is named at an address that carries the version of the UI as a whole (?v=), so a browser
// keeps it for a year and a second visit fetches only the page. The version is read off the files' contents, so it
// moves when one is saved, under the dev server as on a deploy; an address with a version that is not the current
// one is answered with what is current, and not kept.
const named = (path: string) => !MADE.has(path) && UI_FILES[path] !== undefined && path !== '/';
let held: { key: string; version: string; text: Map<string, string>; draw?: { html: string; hashes: string[] } } | undefined;

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
  // The frame's script is two files: what runs in a worker (draw-inside.js, handed to the worker as its text) and the frame's own.
  text.set('draw-marks.js', `${text.get('draw-inside.js')}\n${text.get('draw-marks.js')}`);
  held = { key, version, text };
  return held;
}

/** What runs in a drawing's worker (packs/walls/page/draw-inside.js) as served now: a drawing's service worker is built around it. */
export const drawInside = async () => (await current()).text.get('draw-inside.js')!;

/** The UI's version as served now: it moves when one of its files is saved. */
export const uiVersion = async () => (await current()).version;

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
  return preloaded(text.get(file)!, version, text);
}

/**
 * A page made elsewhere (a server pack's reader) that loads the UI's files: each it names versioned, and what its
 * scripts import asked for at once, as a page of the UI's own is. What it names that is no UI file is left as it is.
 */
export async function uiVersioned(html: string): Promise<string> {
  const { version, text } = await current();
  return preloaded(html.replace(/(<(?:script|link)\b[^>]*\b(?:href|src)=")(\/[\w.-]+)"/g, (all, before, path) => (named(path) ? `${before}${path}?v=${version}"` : all)), version, text);
}

function preloaded(page: string, version: string, text: Map<string, string>): string {
  const scripts = [...page.matchAll(/<script[^>]*\bsrc="(\/[\w.-]+\.js)\?v=/g)].map((m) => m[1]);
  const preload = reached(text, scripts).map((path) => `<link rel="modulepreload" href="${path}?v=${version}" />`);
  return preload.length ? page.replace('</head>', `    ${preload.join('\n    ')}\n  </head>`) : page;
}

/**
 * The frame drawings run in (draw.html) as served now: its scripts written into it, each with the hash its policy
 * allows it by (packs/walls/kernel/page-policies.ts). The frame has an origin of its own, for which no cache keeps a file, so a script
 * it named would be fetched again on every page, behind whatever the page is reading; written in, it runs as the
 * frame is parsed. The file keeps its scripts by name, as every page does.
 */
export async function drawPage(): Promise<{ html: string; hashes: string[] }> {
  const now = await current();
  if (now.draw) return now.draw;
  const hashes: string[] = [];
  const html = now.text.get('draw.html')!.replace(/<script src="\/([\w.-]+\.js)\?v=\w+"><\/script>/g, (all, file) => {
    const code = now.text.get(file);
    if (code === undefined || code.includes('</script')) return all;
    hashes.push(createHash('sha256').update(code).digest('base64'));
    return `<script>${code}</script>`;
  });
  return (now.draw = { html, hashes });
}

/** One file of the UI as served now, and whether the address asked for may be kept (it names the current version). */
export async function uiFile(file: string, version: string | null): Promise<{ body: string | Buffer; keep: boolean }> {
  const now = await current();
  const body = now.text.get(file) ?? (await readFile(pathOf(file)));
  return { body, keep: version === now.version };
}
