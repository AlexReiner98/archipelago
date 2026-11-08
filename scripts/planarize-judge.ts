// The whole-map embedding (task e_snvzsxj4) drawn plainly for the owner to judge, beside what the flow draws today.
//   node scripts/planarize-judge.ts [replay names...] [--from <folder of flow replays>] [--png]
// Each replay (scripts/flow-replay.ts, kept under runs/flow-replay/<name>.json) is the exact answer a page drew. Its
// graph is made with the layouts' kit, planarized whole (packs/core/layouts/planarize/), and drawn as a
// visibility drawing: each island's border a loop, crossings as dots, ports as squares on the border, turned wires red.
// Writes runs/planarize/<name>.svg, <name>.embedding.json (step 2's input), an index.html with the counts beside the
// flow's, and with --png a picture of each.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..'), LAYOUTS = join(ROOT, 'packs', 'core', 'layouts');
const argv = process.argv.slice(2), png = argv.includes('--png');
const fromAt = argv.indexOf('--from');
const common = () => join(execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: ROOT }).toString().trim(), '..');
const from = fromAt >= 0 ? argv[fromAt + 1] : [join(ROOT, 'runs', 'flow-replay'), join(common(), 'runs', 'flow-replay')].find((d) => existsSync(d))!;
const names = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--from');
const wanted = names.length ? names : ['built', 'principles', 'ias', 'study'];
const out = join(ROOT, 'runs', 'planarize');
/** The house style's sizes: a replay kept before planarize's were named lacks them. */
const house = JSON.parse(readFileSync(join(ROOT, 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
mkdirSync(out, { recursive: true });

/** The flow's, the kit's and the planarize modules side by side, under the names they import each other by. */
const dir = mkdtempSync(join(tmpdir(), 'planarize-'));
for (const folder of ['flow', 'kit', 'planarize']) for (const f of readdirSync(join(LAYOUTS, folder))) if (f.endsWith('.js')) cpSync(join(LAYOUTS, folder, f), join(dir, f));
const mod = (name: string) => import(pathToFileURL(join(dir, name)).href);
const { model } = await mod('model.js'), { embedding } = await mod('embedding.js'), { visibility } = await mod('plain.js'), { count } = await mod('count.js'), { asInput } = await mod('format.js');

/** The wires of a scene the flow drew, each one line, its bridges closed, and how many places they cross. */
function flowCrossings(scene: any) {
  const lines: number[][][] = [];
  const walk = (n: any) => {
    if (!Array.isArray(n)) return;
    const [tag, attrs] = n;
    if (tag === 'path' && attrs && /^n:/.test(attrs.key ?? '') && /lf-(tie|wire|chain)/.test(attrs.class ?? '')) {
      const nums = [...String(attrs.d).matchAll(/([MLHV])\s*(-?[\d.]+)(?:[ ,](-?[\d.]+))?/g)], line: number[][] = [];
      for (const [, c, a, b] of nums) {
        const last = line.at(-1) ?? [0, 0];
        line.push(c === 'H' ? [Number(a), last[1]] : c === 'V' ? [last[0], Number(a)] : [Number(a), Number(b)]);
      }
      lines.push(line);
    }
    for (const kid of n) walk(kid);
  };
  walk(scene?.svg);
  return { wires: lines.length, crossings: count(lines).crossings };
}

const HUES = ['#2e7d4f', '#a86a12', '#2f5fb3', '#8a3fa0', '#b0473a', '#2c8c8c', '#6b6b1f'];
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** The embedding drawn plainly, as a visibility drawing: an SVG string. */
function drawn(e: any, m: any, title: string) {
  const { row, column, span } = visibility(e), COL = 16, ROW = 30, pad = 60, top = 70;
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const X = (c: number) => pad + c * COL, Y = (v: string) => top + row.get(v) * ROW, mid = (v: string) => X((span.get(v)[0] + span.get(v)[1]) / 2);
  /** A path through nodes: down each stretch's column, along each node's row between them. */
  const line = (path: string[]) => {
    const out: number[][] = [[mid(path[0]), Y(path[0])]];
    for (let i = 1; i < path.length; i++) {
      const c = X(column.get(key(path[i - 1], path[i]))), at = (v: string) => (/^(ghost|junction)/.test(v) || i === 1 && v === path[0] || i === path.length - 1 && v === path.at(-1) ? mid(v) : mid(v));
      out.push([c, Y(path[i - 1])], [c, Y(path[i])], [at(path[i]), Y(path[i])]);
    }
    return out.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ');
  };
  const width = pad * 2 + COL * (Math.max(...column.values()) + 1), height = top + ROW * (Math.max(...row.values()) + 2);
  const islands = [...e.borders.keys()], hue = new Map(islands.map((i: string, k: number) => [i, HUES[k % HUES.length]]));
  const svg: string[] = [];
  for (const island of islands) {
    const ring = e.borders.get(island);
    svg.push(`<polygon points="${line([...ring, ring[0]])}" fill="${hue.get(island)}" fill-opacity="0.08" stroke="${hue.get(island)}" stroke-width="2.5"/>`);
  }
  for (const w of e.wires) {
    if (w.path.length < 2) continue;
    const colour = w.turned ? '#d02020' : w.order ? '#222' : w.directed ? '#8a8a8a' : '#999';
    const thick = w.trunk !== undefined ? 3 : w.order ? 1.8 : 1.2, dash = w.directed ? '' : ' stroke-dasharray="5 4"';
    const say = `${w.types.join(', ')}${w.turned ? ' (turned: runs up)' : ''}${w.trunk !== undefined ? ` (trunk ${w.trunk})` : ''}`;
    svg.push(`<polyline points="${line(w.path)}" fill="none" stroke="${colour}" stroke-width="${thick}"${dash}><title>${esc(say)}</title></polyline>`);
    // Where its head is: at the foot, or, turned, at the top.
    const end = w.turned ? w.path[0] : w.path.at(-1);
    if (w.directed && m.nodes.has(end)) { const [x, y] = [X(column.get(key(...(w.turned ? [w.path[0], w.path[1]] : [w.path.at(-2), w.path.at(-1)]) as [string, string]))), Y(end)], d = w.turned ? 1 : -1; svg.push(`<path d="M${x - 4},${y + d * 9}L${x},${y + d * 3}L${x + 4},${y + d * 9}" fill="none" stroke="${colour}" stroke-width="1.4"/>`); }
  }
  for (const j of e.junctions) { const [x, y] = [mid(j.id), Y(j.id)]; svg.push(`<path d="M${x},${y - 6}L${x + 6},${y}L${x},${y + 6}L${x - 6},${y}Z" fill="#2f5fb3"><title>junction of trunk ${j.trunk}</title></path>`); }
  for (const c of e.crossings) svg.push(`<circle cx="${mid(c)}" cy="${Y(c)}" r="4.5" fill="#000"/>`);
  for (const [v, p] of e.portAt) svg.push(`<rect x="${mid(v) - 5}" y="${Y(v) - 5}" width="10" height="10" fill="#fff" stroke="${hue.get(p.island)}" stroke-width="2.5"/>`);
  for (const [id, n] of m.nodes) {
    if (!span.has(id)) continue;
    const [a, b] = span.get(id), name = String(n.item?.title ?? id), y = Y(id);
    svg.push(`<rect x="${X(a) - 5}" y="${y - 4}" width="${X(b) - X(a) + 10}" height="8" rx="2" fill="${hue.get(e.place.get(id)) ?? '#555'}"><title>${esc(name)}</title></rect><text x="${X(b) + 8}" y="${y - 6}" font-size="10" fill="#333">${esc(name.length > 30 ? `${name.slice(0, 29)}…` : name)}<title>${esc(name)}</title></text>`);
  }
  return { size: [width, height], svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="system-ui, sans-serif"><rect width="${width}" height="${height}" fill="#fbfaf7"/><text x="20" y="32" font-size="18" fill="#222">${esc(title)}</text>${svg.join('')}</svg>` };
}

const rows: string[] = [], told: any[] = [], sizes = new Map<string, number[]>();
for (const name of wanted) {
  const kept = JSON.parse(readFileSync(join(from, `${name}.json`), 'utf8')), { answer, style } = kept.input;
  const measure = (text: string, px: number) => String(text).length * px * 0.55;
  const m = model({ items: answer.items, links: answer.links ?? [], undrawn: style.undrawn ?? [], headless: style.headless ?? [], measure, sizes: style.sizes });
  const started = performance.now();
  const e = embedding(m, { sizes: { ...house.sizes, ...style.sizes }, headless: style.headless ?? [], islandOf: (id: string) => m.nodes.get(id)?.item?.island ?? null });
  const ms = Math.round(performance.now() - started), flow = flowCrossings(kept.scene), c = e.counts;
  const orderOnly = embedding(m, { sizes: { ...house.sizes, ...style.sizes }, headless: style.headless ?? [], islandOf: (id: string) => m.nodes.get(id)?.item?.island ?? null, down: 'order' }).counts.crossings;
  const islandName = (id: string) => (answer.islands ?? []).find((i: any) => i.id === id)?.title ?? id;
  const ports = Object.entries(c.ports).map(([i, n]) => `${islandName(i)}: ${n}`).join('; ') || 'none';
  const picture = drawn(e, m, `${name} (${kept.lens}): ${c.crossings} crossings, ${c.turned} turned, ${c.trunks} trunks; flow today ${flow.crossings} crossings`);
  writeFileSync(join(out, `${name}.svg`), picture.svg);
  // Step 2's input (task e_7vp7udzk), and whether it is one planar piece (Euler: nodes - edges + faces = 2).
  const input = asInput(e, m), euler = input.nodes.length - input.edges.length + input.faces.length;
  writeFileSync(join(out, `${name}.embedding.json`), JSON.stringify(input));
  sizes.set(name, picture.size);
  told.push({ name, lens: kept.lens, ...c, ms, flow, orderOnly, euler });
  rows.push(`<tr><td>${name}<br><small>${kept.lens}</small></td><td>${c.steps}</td><td>${c.wires}</td><td>${flow.crossings}</td><td><b>${c.crossings}</b></td><td>${orderOnly}</td><td>${c.turned}</td><td>${c.byIslands}</td><td>${c.ties}</td><td>${c.trunks}</td><td>${c.up}</td><td>${c.twice}</td><td>${esc(ports)}</td><td>${ms}</td></tr>`);
  console.log(JSON.stringify(told.at(-1)));
}
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Planarized whole</title><style>body{font:14px system-ui;margin:24px;background:#fbfaf7}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:4px 10px;text-align:left}img{width:100%;max-width:1400px;border:1px solid #ddd;margin:12px 0}</style>
<h1>Step 1: the whole map planarized at once</h1>
<table><tr><th>view</th><th>steps</th><th>wires</th><th>flow today: crossings</th><th>crossings</th><th>crossings, only order held down</th><th>turned (run up)</th><th>turned to keep islands whole</th><th>headless pairs</th><th>trunks</th><th>against their way</th><th>cross a border twice</th><th>ports per island</th><th>ms</th></tr>${rows.join('')}</table>
${wanted.map((n) => `<h2>${n}</h2><img src="${n}.svg">`).join('\n')}`);
writeFileSync(join(out, 'counts.json'), JSON.stringify(told, null, 1));
if (png) {
  const { open } = await import('../test/browser.ts');
  const page = await open('about:blank');
  for (const name of wanted) {
    const [w, h] = sizes.get(name)!;
    await page.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(w), height: Math.ceil(h), deviceScaleFactor: 1, mobile: false });
    await page.go(pathToFileURL(join(out, `${name}.svg`)).href);
    writeFileSync(join(out, `${name}.png`), await page.screenshot());
  }
  await page.close();
}
console.log(`Written to ${out}`);
process.exit();
