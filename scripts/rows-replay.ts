// The rows layout (packs/core/layouts/rows/) drawn offline on a flow replay (scripts/flow-replay.ts keeps them, under
// runs/flow-replay/<name>.json): the replay's answer and measured widths as the model, the layout run in Node, the
// picture written as an SVG and a PNG beside it, with how long the layout took and every stage it told.
//   node scripts/rows-replay.ts <name> [replay folder] [out folder]
// A sketch to judge by eye until the layout is registered and drawn by the page: boxes, island frames, wires.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
// @ts-expect-error a drawing's modules are plain JavaScript
import { lengthsOf, rowsOf } from '../packs/core/layouts/rows/index.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { modelOf } from '../packs/core/layouts/rows/model.js';

const [name, from = join(import.meta.dirname, '..', 'runs', 'flow-replay'), to = join(import.meta.dirname, '..', 'runs', 'rows')] = process.argv.slice(2);
if (!name) throw new Error('rows-replay <name> [replay folder] [out folder]');
const kept = JSON.parse(readFileSync(join(from, `${name}.json`), 'utf8'));
const own = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs', 'core', 'layouts', 'rows', 'sizes.json'), 'utf8'));
const style = kept.input.style, sizes = { ...style.sizes, ...own.sizes }, numbers = { ...style.numbers, ...own.numbers };
let guessed = 0;
const measure = (words: string, px: number) => {
  const key = `400 ${px}px ${style.font || 'system-ui'}|${words}`;
  if (kept.widths[key] !== undefined) return kept.widths[key];
  guessed++;
  return [...String(words)].length * px * 0.55;
};
const model = modelOf(kept.input.answer, { measure, sizes, undrawn: Array.isArray(style.undrawn) ? style.undrawn : [] });
const stages: { name: string; snapshot: unknown }[] = [];
const t0 = performance.now();
const pic = rowsOf(model, lengthsOf(sizes, numbers), (n: string, snapshot: unknown) => stages.push({ name: n, snapshot }));
const ms = performance.now() - t0;

const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hue: Record<string, string> = { depends_on: '#3fb8af', order: '#3fb8af', about: '#8a8f98', reads: '#c792ea', calls: '#e0a458', bears_on: '#82aaff', uses: '#e06c75' };
const M = 24, W = Math.ceil(pic.w + 2 * M), H = Math.ceil(pic.h + 2 * M);
const svg: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${-M} ${-M} ${W} ${H}" font-family="system-ui" font-size="13">`,
  '<defs>', ...Object.entries(hue).map(([t, c]) => `<marker id="h-${t}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${c}"/></marker>`), '</defs>',
  `<rect x="${-M}" y="${-M}" width="${W}" height="${H}" fill="#171717"/>`];
for (const s of pic.islands) svg.push(`<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="12" fill="#1d2a24" stroke="#2f5a46"/><text x="${s.x + 10}" y="${s.y + 14}" fill="#7fb59a" font-size="10" letter-spacing="1">${esc(String(s.title).toUpperCase())}</text>`);
for (const p of pic.parts) svg.push(`<polyline points="${p.points.map((q: number[]) => q.join(',')).join(' ')}" fill="none" stroke="#4a4f57" stroke-width="1"/>`);
for (const w of pic.wires) {
  const c = hue[w.type] ?? '#8a8f98', m = hue[w.type] ? w.type : 'about', dash = w.kind === 'back' ? ' stroke-dasharray="5 4"' : '';
  const ends = w.head === 'a' ? ` marker-start="url(#h-${m})"` : w.head === 'b' ? ` marker-end="url(#h-${m})"` : '';
  svg.push(`<polyline points="${w.points.map((q: number[]) => q.join(',')).join(' ')}" fill="none" stroke="${c}" stroke-width="1.25" stroke-opacity="${w.type === 'depends_on' ? 1 : 0.75}"${dash}${ends}/>`);
}
const lines = new Map(model.items.map((i: any) => [i.id, i.lines]));
for (const [id, b] of pic.places) {
  const said: string[] = lines.get(id) ?? [id];
  svg.push(`<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" fill="#222" stroke="#9aa0a6" stroke-width="1.25"/>`);
  said.forEach((t, k) => svg.push(`<text x="${b.x + 21}" y="${b.y + b.h / 2 + (k - (said.length - 1) / 2) * 16}" fill="#e8e8e8" dominant-baseline="middle">${esc(t)}</text>`));
}
svg.push('</svg>');
mkdirSync(to, { recursive: true });
writeFileSync(join(to, `${name}.svg`), svg.join('\n'));
writeFileSync(join(to, `${name}.stages.json`), JSON.stringify({ ms, stages }));
const page = await open('about:blank');
await page.send('Emulation.setDeviceMetricsOverride', { width: Math.min(W, 4000), height: Math.min(H, 4000), deviceScaleFactor: 1, mobile: false });
await page.evaluate(`document.body.style.margin='0'; document.body.innerHTML = ${JSON.stringify(svg.join('\n'))}; true`);
writeFileSync(join(to, `${name}.png`), await page.screenshot());
await page.close();
const crossings = (() => {
  // Merged wires overlap on purpose: each stretch is counted once, and a crossing is two different stretches meeting.
  const unique = new Map<string, any>();
  for (const w of pic.wires) w.points.slice(1).forEach((p: number[], k: number) => { const q = w.points[k], key = [q, p].map((v) => v.join(',')).sort().join(' '); if (!unique.has(key)) unique.set(key, [q, p, key]); });
  const segs = [...unique.values()];
  let n = 0;
  for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
    const [[a, b, u], [c, d, v]] = [segs[i], segs[j]];
    if (u === v) continue;
    const [h1, h2] = [a[1] === b[1], c[1] === d[1]];
    if (h1 === h2) continue;
    const [hz, vt] = h1 ? [[a, b], [c, d]] : [[c, d], [a, b]];
    const x = vt[0][0], y = hz[0][1];
    if (x > Math.min(hz[0][0], hz[1][0]) && x < Math.max(hz[0][0], hz[1][0]) && y > Math.min(vt[0][1], vt[1][1]) && y < Math.max(vt[0][1], vt[1][1])) n++;
  }
  return n;
})();
// A wire through a box that is not one of its ends.
const through: string[] = [];
for (const w of pic.wires) {
  const own = new Set([w.link?.from, w.link?.to]);
  for (const [id, b] of pic.places as Map<string, any>) {
    if (own.has(id)) continue;
    w.points.slice(1).forEach((p: number[], k: number) => {
      const q = w.points[k], [x0, x1] = [Math.min(p[0], q[0]), Math.max(p[0], q[0])], [y0, y1] = [Math.min(p[1], q[1]), Math.max(p[1], q[1])];
      if (x1 > b.x + 1 && x0 < b.x + b.w - 1 && y1 > b.y + 1 && y0 < b.y + b.h - 1) through.push(`${w.id} through ${id}`);
    });
  }
}
if (through.length) console.log(`${through.length} wires through boxes, e.g. ${through.slice(0, 3).join('; ')}`);
console.log(`${name}: ${model.items.length} items, ${pic.wires.length} wires, ${pic.islands.length} islands, ${Math.round(pic.w)} by ${Math.round(pic.h)}, ${crossings} crossings, laid out in ${ms.toFixed(1)} ms${guessed ? `, ${guessed} widths guessed` : ''} -> ${join(to, name)}.png`);
process.exit();
