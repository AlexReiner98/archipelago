// What each stage of Plane's layout does to its wires, and a fingerprint of what it draws, on real views of a map:
//   node scripts/plane-stages.ts [http://127.0.0.1:3100] [--fresh]
// Each view is read once from the server and kept under runs/plane-stages, with its text widths from Chrome, so two runs
// compare like with like: a change that should alter no picture leaves every fingerprint as it was. --fresh reads them
// again. Wires are told apart by the way they run, since a fault on one axis says little of the other.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromeBinary } from '../src/chrome.ts';
import { layout, stages } from '../packs/core/draw/flow/layout.js';
import { count } from '../packs/core/draw/flow/count.js';
import { faults, spacing } from '../packs/core/draw/flow/faults.js';
import { shownOnly } from '../packs/core/draw/flow/graph.js';
import { placesAsColours } from '../packs/core/draw/flow/places.js';

const args = process.argv.slice(2), fresh = args.includes('--fresh');
const base = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3100';
const home = join(import.meta.dirname, '..', 'runs', 'plane-stages');
mkdirSync(home, { recursive: true });
const VIEWS = [['rework', 'in e_kg5pmxx6', 200], ['repository', 'in e_dqcd2vwb', 500], ['study', 'in e_w5z8gub5', 200]] as const;
const WIDTH = 1800, HEIGHT = 1000;

const ask = async (name: string, params: unknown) => {
  const res = await fetch(`${base}/agent/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, params }) });
  return (await res.json()).result;
};
const kept = async <T>(file: string, read: () => Promise<T>): Promise<T> => {
  const path = join(home, file);
  if (!fresh && existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const value = await read();
  writeFileSync(path, JSON.stringify(value));
  return value;
};

const widthsAt = join(home, 'widths.json');
const widths: Record<string, number> = existsSync(widthsAt) ? JSON.parse(readFileSync(widthsAt, 'utf8')) : {};
/** Ask Chrome how wide each text is drawn: "<font>|<text>". */
function measureAll(keys: string[]) {
  const page = join(home, 'widths.html');
  writeFileSync(page, `<!doctype html><meta charset=utf-8><pre id=o></pre><script>const k=${JSON.stringify(keys).replaceAll('<', '\\u003c')};const c=document.createElement('canvas').getContext('2d'),o={};for(const e of k){const i=e.indexOf('|');c.font=e.slice(0,i);o[e]=c.measureText(e.slice(i+1)).width}document.getElementById('o').textContent=JSON.stringify(o)</script>`);
  const out = execFileSync(chromeBinary()!, ['--headless=new', '--disable-gpu', '--virtual-time-budget=3000', '--dump-dom', pathToFileURL(page).href], { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
  const said = /<pre id="o">([\s\S]*?)<\/pre>/.exec(out)![1].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  Object.assign(widths, JSON.parse(said));
  writeFileSync(widthsAt, JSON.stringify(widths));
}

const style: any = (await kept('style.json', () => ask('style', { shape: 'plane' }))).style;
const row = (tag: string, s: any) => `${tag.padEnd(16)}${[s.overlaps, Math.round(s.overlapLength), s.shared, s.under, s.at, s.between, s.wide].map((n) => String(n).padStart(7)).join('')}`;
const HEAD = `${''.padEnd(16)}${['real', 'long', 'shared', '<gap', '=gap', '<2gap', '>=2gap'].map((n) => n.padStart(7)).join('')}`;

for (const [name, find, limit] of VIEWS) {
  const answer: any = await kept(`${name}.json`, () => ask('flat', { filter: { find: [find] }, limit }));
  const shown = shownOnly(answer), hues = (style.place_hues ?? []).filter((h: unknown) => /^#[0-9a-f]{3,8}$/i.test(String(h)));
  const items = placesAsColours(shown, hues, new Set([style.here, answer.lens?.from].filter(Boolean))).items;
  const [ASPECT, FOLLOW] = [style.numbers.flow_aspect, style.numbers.flow_aspect_follow];
  const input = { items, links: shown.links ?? [], undrawn: style.undrawn ?? [], headless: style.headless ?? [], sizes: { ...style.sizes }, aspect: ASPECT * ((WIDTH / HEIGHT) / ASPECT) ** FOLLOW };
  for (let round = 0; ; round++) {
    const missing = new Set<string>();
    const measure = (text: string, px: number) => {
      const key = `400 ${px}px ${style.font}|${text}`;
      if (widths[key] === undefined) missing.add(key);
      return widths[key] ?? text.length * px * 0.52;
    };
    // Another round of sizes, so the layout does not answer from what it kept: it keys on what it was given.
    layout({ ...input, sizes: { ...input.sizes, measured: round }, measure });
    if (!missing.size || round > 5) break;
    measureAll([...missing]);
  }
  const shots: [string, any][] = [];
  stages((stage: string, routes: Map<string, any>) => shots.push([`${stage} ${count([...routes.values()].map((r) => r.points)).crossings}x`, spacing([...routes].map(([k, r]) => ({ ends: k.split('|'), points: r.points })), style.sizes.plane_wire_gap)]));
  const began = performance.now();
  const g: any = layout({ ...input, measure: (text: string, px: number) => widths[`400 ${px}px ${style.font}|${text}`] ?? text.length * px * 0.52 });
  const took = Math.round(performance.now() - began);
  stages(null);
  const wires = [...g.chains, ...g.ties].filter((w: any) => w.points);
  shots.push(['final', spacing(wires.map((w: any) => ({ ends: [w.a, w.b], points: w.points })), style.sizes.plane_wire_gap)]);
  const drawn = JSON.stringify([[...g.x].sort(), [...g.y].sort(), wires.map((w: any) => [w.a, w.b, w.points]), g.width, g.height]);
  const f: any = faults(g, { run: style.sizes.plane_port_run, clear: style.sizes.plane_wire_room, join: style.sizes.plane_joined_room, corner: style.sizes.plane_port_corner, parallel: style.sizes.plane_wire_gap, headless: style.headless });
  console.log(`\n${name}: ${g.all.length} steps, ${wires.length} wires, ${Math.round(g.width)} by ${Math.round(g.height)}, ${took} ms, fingerprint ${createHash('sha256').update(drawn).digest('hex').slice(0, 16)}`);
  console.log(`  ${count(wires.map((w: any) => w.points)).crossings} crossings, ${f.bends} bends, ${f.up} of ${f.headed} up, ${f.back} double back, ${f.tightBox} tight to a box`);
  console.log(`  running down${HEAD.slice(14)}`);
  for (const [stage, s] of shots) console.log(`  ${row(stage, s.down)}`);
  console.log(`  running across${HEAD.slice(16)}`);
  for (const [stage, s] of shots) console.log(`  ${row(stage, s.across)}`);
}
