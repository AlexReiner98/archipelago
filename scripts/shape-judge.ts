// Step 2's sketch (task e_7vp7udzk) drawn plainly on its grid for the owner to judge: each embedding step 1 wrote
// (runs/planarize/<name>.embedding.json) shaped at right angles (packs/core/layouts/shape/) and drawn cell for cell,
// boxes as their grid rectangles, islands as theirs, crossings as dots, ports as squares, junctions as small dots,
// turned wires red. The grid keeps order, not distance: step 3 sets the sizes.
//   node scripts/shape-judge.ts [names...] [--from <folder of embeddings>] [--png]
// Writes runs/shape/<name>.svg, <name>.sketch.json (step 3's input) and index.html with the counts.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
// @ts-expect-error a drawing's modules are plain JavaScript
import { shape } from '../packs/core/layouts/shape/index.js';

const ROOT = join(import.meta.dirname, '..'), argv = process.argv.slice(2), png = argv.includes('--png');
const common = () => join(execSync('git rev-parse --path-format=absolute --git-common-dir', { cwd: ROOT }).toString().trim(), '..');
const fromAt = argv.indexOf('--from');
const from = fromAt >= 0 ? argv[fromAt + 1] : join(ROOT, 'runs', 'planarize');
const names = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--from');
const wanted = names.length ? names : ['built', 'principles', 'ias', 'study'];
const out = join(ROOT, 'runs', 'shape');
mkdirSync(out, { recursive: true });
const CELL = 14, PAD = 20;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Titles of the items, from the flow replay step 1 read, where there is one. */
function titles(name: string) {
  const at = [join(ROOT, 'runs', 'flow-replay', `${name}.json`), join(common(), 'runs', 'flow-replay', `${name}.json`)].find((p) => existsSync(p));
  if (!at) return new Map<string, string>();
  return new Map<string, string>(JSON.parse(readFileSync(at, 'utf8')).input.answer.items.map((i: any) => [i.id, i.title]));
}

function draw(name: string, s: any, title: Map<string, string>) {
  const X = (v: number) => PAD + v * CELL, maxX = Math.max(...s.nodes.map((n: any) => n.x + n.w / 2)), maxY = Math.max(...s.nodes.map((n: any) => n.y + n.h / 2));
  const W = X(maxX) + PAD, H = X(maxY) + PAD, parts: string[] = [];
  parts.push(`<rect width="${W}" height="${H}" fill="#fbfaf7"/>`);
  for (let i = 0; i <= maxX; i++) parts.push(`<line x1="${X(i)}" y1="${PAD}" x2="${X(i)}" y2="${X(maxY)}" stroke="#eeeae2" stroke-width="1"/>`);
  for (let j = 0; j <= maxY; j++) parts.push(`<line x1="${PAD}" y1="${X(j)}" x2="${X(maxX)}" y2="${X(j)}" stroke="#eeeae2" stroke-width="1"/>`);
  for (const i of s.islands) {
    const [x0, y0, x1, y1] = i.rect;
    parts.push(`<rect x="${X(x0)}" y="${X(y0)}" width="${(x1 - x0) * CELL}" height="${(y1 - y0) * CELL}" fill="#e9f0e4" stroke="#8aa77a" stroke-width="2"/>`);
  }
  for (const w of s.wires) {
    if (w.type === 'unseen' || w.type === 'border') continue;
    const colour = w.reversed ? '#c0392b' : w.type === 'depends_on' ? '#333' : '#8a8f99';
    parts.push(`<polyline points="${w.points.map((p: number[]) => `${X(p[0])},${X(p[1])}`).join(' ')}" fill="none" stroke="${colour}" stroke-width="${w.type === 'depends_on' ? 2 : 1.3}"><title>${esc(w.type)}</title></polyline>`);
  }
  for (const n of s.nodes) {
    if (n.kind === 'item') {
      const t = title.get(n.id) ?? n.id, x = X(n.x - n.w / 2), y = X(n.y - n.h / 2), w = n.w * CELL, h = n.h * CELL;
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#556" stroke-width="1.2"><title>${esc(t)}</title></rect>`);
      const fit = Math.max(1, Math.floor(w / 6));
      parts.push(`<text x="${x + 3}" y="${y + Math.min(h, CELL) - 4}" font-size="9" font-family="sans-serif" fill="#223">${esc(t.length > fit ? `${t.slice(0, fit - 1)}…` : t)}</text>`);
    } else if (n.kind === 'cross') parts.push(`<circle cx="${X(n.x)}" cy="${X(n.y)}" r="3" fill="#d35400"/>`);
    else if (n.kind === 'port') parts.push(`<rect x="${X(n.x) - 4}" y="${X(n.y) - 4}" width="8" height="8" fill="#2e7d32"/>`);
    else if (n.kind === 'junction') parts.push(`<circle cx="${X(n.x)}" cy="${X(n.y)}" r="2" fill="#333"/>`);
  }
  writeFileSync(join(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${parts.join('')}</svg>`);
  return [W, H];
}

const rows: string[] = [], sizes = new Map<string, number[]>();
for (const name of wanted) {
  const file = join(from, `${name}.embedding.json`);
  if (!existsSync(file)) { console.log(`no embedding for ${name} at ${file}`); continue; }
  const emb = JSON.parse(readFileSync(file, 'utf8')), t = Date.now(), s = shape(emb), ms = Date.now() - t;
  writeFileSync(join(out, `${name}.sketch.json`), JSON.stringify(s));
  sizes.set(name, draw(name, s, titles(name)));
  const crosses = s.nodes.filter((n: any) => n.kind === 'cross').length, w = Math.max(...s.nodes.map((n: any) => n.x + n.w / 2)), h = Math.max(...s.nodes.map((n: any) => n.y + n.h / 2));
  rows.push(`<tr><td>${name}</td><td>${s.nodes.filter((n: any) => n.kind === 'item').length}</td><td>${s.wires.filter((x: any) => x.type !== 'unseen' && x.type !== 'border').length}</td><td>${crosses}</td><td>${s.bends}</td><td>${w} x ${h}</td><td>${s.against ? 'yes' : 'no'}</td><td>${ms}</td></tr>`);
  console.log(name, { bends: s.bends, crosses, grid: `${w}x${h}`, against: s.against, ms });
}
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Step 2: shape</title>
<style>body{font:14px sans-serif;margin:24px}table{border-collapse:collapse}td,th{border-bottom:1px solid #ddd;padding:4px 10px;text-align:right}img{display:block;margin:12px 0 32px;max-width:100%}</style>
<h1>Step 2: the embedding shaped at right angles</h1>
<table><tr><th>view</th><th>boxes</th><th>wires</th><th>crossings</th><th>bends</th><th>grid</th><th>a rule broken</th><th>ms</th></tr>${rows.join('')}</table>
${wanted.filter((n) => sizes.has(n)).map((n) => `<h2>${n}</h2><img src="${n}.svg">`).join('\n')}`);
if (png) {
  const { open } = await import('../test/browser.ts');
  const page = await open('about:blank');
  for (const [name, [w, h]] of sizes) {
    await page.send('Emulation.setDeviceMetricsOverride', { width: Math.ceil(w), height: Math.ceil(h), deviceScaleFactor: 1, mobile: false });
    await page.go(pathToFileURL(join(out, `${name}.svg`)).href);
    writeFileSync(join(out, `${name}.png`), await page.screenshot());
  }
  await page.close();
}
console.log(`Written to ${out}`);
process.exit();
