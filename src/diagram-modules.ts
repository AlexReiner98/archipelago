// The module architecture as diagrams: the server's modules (src/), the page's (ui/) and the packs' code (packs/),
// grouped by area, with what imports what. An overview draws the areas and the imports between them; a page for
// each area draws its modules in layers (what imports above what it imports), with the areas it uses below and
// the areas that use it above. Handed the files as text; reads nothing itself.

import { html, layers, legend, style, wrap, type Edge, type Page, type Vertex } from './diagram-xml.ts';

export interface SourceFile {
  /** Its path from the repository's root, with forward slashes: src/pelago.ts. */
  path: string;
  text: string;
}

export interface Module {
  path: string;
  name: string;
  band: 'server' | 'browser' | 'packs';
  area: string;
  lines: number;
  /** Its first comment, as the tooltip says what it is. */
  about: string;
  imports: Array<{ to: string; dynamic: boolean }>;
}

/** The areas of each band, matched by file name in order; a file no rule names falls in the band's last area. */
const AREAS: Record<'server' | 'browser', Array<[string, RegExp]>> = {
  server: [
    ['Write path and model', /^(pelago|ops|fields|rules|confirm|undo|eventlog|bounds|capabilities|typetable|schema-brief)\.ts$/],
    ['Packs', /^(packs|packhost|pack-runner|packorder|packreads|packstate|packtools|declared|screens|outside|hooks)\.ts$/],
    ['Views and lenses', /^(views|askview|attention|blocking|brief|lens.*|pictures|places|timeaxis|spent|presence|documents|public)\.ts$/],
    ['Sessions and agents', /^(sessions|sessiontime|tools|share-tools|backup-tools|launcher|notify|outbox|automations|automation-rules|duties|transient|hook-answers|reader)\.ts$/],
    ['Database and tenancy', /^(db|pg|schema|migrate|deploy|workspaces|scope|backup|pull|leader|secrets)\.ts$/],
    ['GitHub', /^github.*\.ts$/],
    ['Diagrams', /^diagram.*\.ts$/],
    ['Server and surfaces', /./],
  ],
  browser: [
    ['Item page', /^(item.*|body|review|proof|forms)\.js$/],
    ['Pictures', /^(lens.*|graph.*|flow.*|grid|list|timeline|roadmap|pan-zoom|draw|style-code)\.(js|html)$/],
    ['Home and workspace', /^(home|attention|workspace.*|packs|screens|nav|search)\.js$/],
    ['Time', /^(time|week)\.js$/],
    ['Shared documents', /^(doc|public)\.(js|html)$/],
    ['Shell', /./],
  ],
};

const IMPORT = /^\s*import\s+(?!type\b)(?:[^;'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm;
const DYNAMIC = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
const SCRIPT = /<script\b[^>]*\bsrc="\/([^"]+)"/g;

const firstComment = (text: string) => {
  const m = text.match(/^(?:\s*\/\/[^\n]*\n)+/) ?? text.match(/^\s*\/\*\*?([\s\S]*?)\*\//);
  const said = (m?.[0] ?? '').replace(/^\s*(\/\/|\/\*\*?|\*\/?)\s?/gm, ' ').replace(/\s+/g, ' ').trim();
  const stop = said.search(/[.:;](\s|$)/);
  return (stop > 0 ? said.slice(0, stop + 1) : said).slice(0, 200);
};

const bandOf = (path: string): Module['band'] | null =>
  path.startsWith('src/') ? 'server' : path.startsWith('ui/') ? 'browser' : path.startsWith('packs/') ? 'packs' : null;

/** Resolve a relative specifier against the importing file's folder. */
function resolve(from: string, spec: string): string {
  const parts = from.split('/').slice(0, -1);
  for (const p of spec.split('/')) {
    if (p === '..') parts.pop();
    else if (p !== '.') parts.push(p);
  }
  return parts.join('/');
}

/** The modules of the files given, each with its area and what it imports of the others. */
export function readModules(files: SourceFile[]): Module[] {
  const code = files.filter((f) => bandOf(f.path) && /\.(ts|js|html)$/.test(f.path) && !/\.test\.ts$/.test(f.path) && !/\.min\.js$/.test(f.path));
  const paths = new Set(code.map((f) => f.path));
  const modules = code.map((f): Module => {
    const band = bandOf(f.path)!;
    const name = f.path.split('/').pop()!;
    const area = band === 'packs' ? `${f.path.split('/')[1]} pack` : AREAS[band].find(([, re]) => re.test(name))![0];
    const imports = new Map<string, boolean>();
    const add = (spec: string, dynamic: boolean) => {
      const to = f.path.endsWith('.html') ? `ui/${spec}` : spec.startsWith('.') ? resolve(f.path, spec) : null;
      if (to && to !== f.path && paths.has(to) && !imports.has(to)) imports.set(to, dynamic);
    };
    if (f.path.endsWith('.html')) for (const [, s] of f.text.matchAll(SCRIPT)) add(s, false);
    else {
      for (const [, s] of f.text.matchAll(IMPORT)) add(s, false);
      for (const [, s] of f.text.matchAll(DYNAMIC)) add(s, true);
    }
    const lines = f.text.split('\n').length - (f.text.endsWith('\n') ? 1 : 0);
    return { path: f.path, name, band, area, lines, about: f.path.endsWith('.html') ? 'A page the browser loads.' : firstComment(f.text), imports: [...imports].map(([to, dynamic]) => ({ to, dynamic })) };
  });
  return modules.sort((a, b) => a.path.localeCompare(b.path));
}

const BANDS: Array<{ band: Module['band']; title: string; fill: string; stroke: string }> = [
  { band: 'browser', title: 'Browser: ui/, served as files, no build step', fill: '#eef5ff', stroke: '#6c8ebf' },
  { band: 'server', title: 'Server: src/, one Node process per app', fill: '#f3f9ee', stroke: '#82b366' },
  { band: 'packs', title: 'Packs: packs/*/, each handler in its own sandboxed process', fill: '#fff6e8', stroke: '#d79b00' },
];
const bandStyle = (band: Module['band']) => BANDS.find((b) => b.band === band)!;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const areaId = (band: string, area: string) => `area-${band}-${slug(area)}`;

const CHIP_W = 132, CHIP_H = 26, GAP = 8, PER_ROW = 3, HEAD = 30;

/** What is drawn of each area: its modules and the imports that cross into other areas. */
function areaGraph(modules: Module[]) {
  const by = new Map(modules.map((m) => [m.path, m]));
  const key = (m: Module) => `${m.band}/${m.area}`;
  const areas = [...new Set(modules.map(key))];
  const between = new Map<string, number>();
  for (const m of modules) for (const i of m.imports) {
    const t = by.get(i.to)!;
    if (key(t) !== key(m)) between.set(`${key(m)}>${key(t)}`, (between.get(`${key(m)}>${key(t)}`) ?? 0) + 1);
  }
  return { by, key, areas, between };
}

function overview(modules: Module[], link: (path: string) => string | undefined): Page {
  const { key, areas, between } = areaGraph(modules);
  const vertices: Vertex[] = [], edges: Edge[] = [];
  let y = 0;
  for (const b of BANDS) {
    const mine = areas.filter((a) => a.startsWith(`${b.band}/`));
    if (!mine.length) continue;
    const pairs = [...between.keys()].map((k) => k.split('>') as [string, string]).filter(([s, t]) => mine.includes(s) && mine.includes(t));
    // In the order of their layers (what imports first), three to a row: a chain of areas would otherwise stand in one column.
    const rows = b.band === 'packs' ? wrap(mine, 4) : wrap(layers(mine, pairs).flat(), 3);
    const size = (a: string) => {
      const n = modules.filter((m) => key(m) === a).length;
      const cols = Math.min(PER_ROW, n);
      return { w: cols * CHIP_W + (cols + 1) * GAP, h: HEAD + Math.ceil(n / PER_ROW) * (CHIP_H + GAP) + GAP };
    };
    const bandId = `band-${b.band}`;
    const inner: Vertex[] = [];
    let ry = 44, width = 0;
    for (const row of rows) {
      let rx = 20;
      const tallest = Math.max(...row.map((a) => size(a).h));
      for (const a of row) {
        const { w, h } = size(a);
        const [band, area] = a.split('/');
        const id = areaId(band, area);
        inner.push({ id, label: area, x: rx, y: ry, w, h, parent: bandId, style: style({ shape: 'swimlane', startSize: HEAD - 6, html: 1, rounded: 1, fontStyle: 1, fillColor: '#ffffff', swimlaneFillColor: '#ffffff', strokeColor: b.stroke, fontSize: 12 }) });
        modules.filter((m) => key(m) === a).forEach((m, i) => {
          inner.push({
            id: `chip-${slug(m.path)}`, label: m.name, parent: id, tooltip: `${m.path}, ${m.lines} lines. ${m.about}`, link: link(m.path),
            x: GAP + (i % PER_ROW) * (CHIP_W + GAP), y: HEAD + Math.floor(i / PER_ROW) * (CHIP_H + GAP), w: CHIP_W, h: CHIP_H,
            style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', fontSize: 11, fillColor: m.lines > 500 ? '#f8cecc' : b.fill, strokeColor: m.lines > 500 ? '#b85450' : b.stroke }),
          });
        });
        rx += w + 40;
      }
      width = Math.max(width, rx);
      ry += tallest + 70;
    }
    vertices.push({ id: bandId, label: b.title, x: 0, y, w: width, h: ry - 20, style: style({ shape: 'swimlane', startSize: 30, html: 1, horizontal: 1, fontStyle: 1, fontSize: 14, fillColor: b.fill, swimlaneFillColor: b.fill, strokeColor: b.stroke, rounded: 0 }) }, ...inner);
    y += ry + 40;
  }
  for (const [k, n] of [...between].sort()) {
    const [s, t] = k.split('>');
    const [sb, sa] = s.split('/'), [tb, ta] = t.split('/');
    edges.push({ id: `imp-${slug(k)}`, from: areaId(sb, sa), to: areaId(tb, ta), label: String(n), style: style({ curved: 1, html: 1, endArrow: 'open', strokeColor: '#555555', opacity: 60, strokeWidth: Math.min(4, 1 + Math.floor(n / 8)), fontSize: 10, labelBackgroundColor: '#ffffff' }) });
  }
  // The bands do not import each other: the server serves the page and runs the packs' handlers.
  const server = vertices.find((v) => v.id === 'band-server');
  if (server && vertices.some((v) => v.id === 'band-browser')) edges.push({ id: 'serves-browser', from: 'band-server', to: 'band-browser', label: 'serves ui/ and answers /api, /mcp', style: style({ dashed: 1, endArrow: 'open', strokeColor: '#6c8ebf', html: 1, fontSize: 11, labelBackgroundColor: '#ffffff' }) });
  if (server && vertices.some((v) => v.id === 'band-packs')) edges.push({ id: 'runs-packs', from: 'band-server', to: 'band-packs', label: 'packhost runs each handler: JSON lines, ops back', style: style({ dashed: 1, endArrow: 'open', strokeColor: '#d79b00', html: 1, fontSize: 11, labelBackgroundColor: '#ffffff' }) });
  const right = Math.max(...vertices.filter((v) => !v.parent).map((v) => v.x + v.w)) + 40;
  vertices.push(...legend('legend', right, 0, [['#555555', 'arrow: imports, labelled with how many'], ['#b85450', 'module over the 500-line rule'], ['#6c8ebf', 'hover a module: its path and what it is']]));
  return { id: 'modules-overview', name: 'Modules: overview', vertices, edges };
}

const BOX_W = 150, BOX_H = 34, COL = 180, ROW = 90;

function areaPage(modules: Module[], area: string, link: (path: string) => string | undefined): Page {
  const { by, key, areas } = areaGraph(modules);
  const mine = modules.filter((m) => key(m) === area);
  const [band, name] = area.split('/');
  const b = bandStyle(band as Module['band']);
  const vertices: Vertex[] = [], edges: Edge[] = [];
  const inside = new Set(mine.map((m) => m.path));
  const rows = layers(mine.map((m) => m.path), mine.flatMap((m) => m.imports.filter((i) => inside.has(i.to)).map((i) => [m.path, i.to] as [string, string])));
  const usedBy = areas.filter((a) => a !== area && modules.some((m) => key(m) === a && m.imports.some((i) => inside.has(i.to))));
  const uses = areas.filter((a) => a !== area && mine.some((m) => m.imports.some((i) => key(by.get(i.to)!) === a)));
  const width = Math.max(...rows.map((r) => r.length), usedBy.length, uses.length, 1) * COL;
  const centred = (n: number, i: number) => (width - n * COL) / 2 + i * COL;
  const outer = (list: string[], y: number, prefix: string) => list.forEach((a, i) => {
    const [ob, oa] = a.split('/');
    const names = modules.filter((m) => key(m) === a).map((m) => m.name);
    vertices.push({ id: `${prefix}-${slug(a)}`, label: `<b>${html(oa)}</b>`, tooltip: names.join(', '), x: centred(list.length, i), y, w: BOX_W, h: BOX_H, style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', dashed: 1, fontSize: 11, fillColor: bandStyle(ob as Module['band']).fill, strokeColor: '#999999' }) });
  });
  outer(usedBy, 0, 'by');
  const top = usedBy.length ? ROW + 20 : 0;
  rows.forEach((row, r) => row.forEach((p, i) => {
    const m = by.get(p)!;
    vertices.push({ id: `mod-${slug(p)}`, label: m.name, tooltip: `${m.path}, ${m.lines} lines. ${m.about}`, link: link(m.path), x: centred(row.length, i), y: top + r * ROW, w: BOX_W, h: BOX_H, style: style({ rounded: 1, html: 1, whiteSpace: 'wrap', fontSize: 12, fontStyle: 1, fillColor: m.lines > 500 ? '#f8cecc' : b.fill, strokeColor: m.lines > 500 ? '#b85450' : b.stroke }) });
  }));
  const bottom = top + rows.length * ROW + 20;
  outer(uses, bottom, 'uses');
  const line = (colour: string, dashed: boolean) => style({ html: 1, endArrow: 'open', strokeColor: colour, dashed: dashed ? 1 : 0, opacity: colour === '#aaaaaa' ? 70 : 100 });
  for (const m of mine) {
    for (const i of m.imports) {
      if (inside.has(i.to)) edges.push({ id: `e-${slug(m.path)}-${slug(i.to)}`, from: `mod-${slug(m.path)}`, to: `mod-${slug(i.to)}`, style: line('#333333', i.dynamic) });
    }
    for (const a of uses) {
      if (m.imports.some((i) => key(by.get(i.to)!) === a)) edges.push({ id: `u-${slug(m.path)}-${slug(a)}`, from: `mod-${slug(m.path)}`, to: `uses-${slug(a)}`, style: line('#aaaaaa', false) });
    }
  }
  for (const a of usedBy) {
    const targets = mine.filter((m) => modules.some((o) => key(o) === a && o.imports.some((i) => i.to === m.path)));
    for (const t of targets) edges.push({ id: `b-${slug(a)}-${slug(t.path)}`, from: `by-${slug(a)}`, to: `mod-${slug(t.path)}`, style: line('#aaaaaa', false) });
  }
  vertices.push(...legend('legend', width + 40, 0, [['#333333', 'imports, within the area (dashed: on demand)'], ['#aaaaaa', 'to and from other areas (dashed boxes)'], ['#b85450', 'module over the 500-line rule']]));
  return { id: `modules-${slug(area)}`, name: `${band === 'packs' ? 'Pack' : band === 'server' ? 'Server' : 'UI'}: ${name}`, vertices, edges };
}

/** The pages of the module diagram: the overview, then one for each area of more than one module. */
export function moduleDiagram(files: SourceFile[], link: (path: string) => string | undefined = () => undefined): Page[] {
  const modules = readModules(files);
  const { key, areas } = areaGraph(modules);
  const order = (a: string) => ['server', 'browser', 'packs'].findIndex((b) => a.startsWith(`${b}/`));
  const detailed = areas.filter((a) => modules.filter((m) => key(m) === a).length > 1).sort((a, b) => order(a) - order(b) || a.localeCompare(b));
  return [overview(modules, link), ...detailed.map((a) => areaPage(modules, a, link))];
}
