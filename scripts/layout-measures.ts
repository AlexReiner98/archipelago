// What each layout's picture does well, read off it (task e_tgmq6ffu). Every flow replay (scripts/flow-replay.ts keeps
// them: the answer, style and text widths a page used) is drawn through each layout's own entry, as the page draws it,
// and each finished picture measured from its marks (./measures/): order wires running up and on which side, bends,
// detour, the most wires side by side, names readable on a 1600 by 1000 screen, how far items move when one is added,
// time to draw, and crossings as a footnote. Writes one table per view (layouts as columns) and a page with each
// picture under its numbers, in runs/layout-measures/.
//   node scripts/layout-measures.ts [--layouts core.flow,core.strips,...] [--views built,principles,...] [--from <replay folder>] [--to <out folder>] [--no-pictures]
// A new layout is measured by naming its id in --layouts (or in LAYOUTS below), once pack.json lists it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
import { drawings, setOut } from '../test/wired.ts';
import { measure, moved } from './measures/measures.ts';
import { page, table, type Drawn, type View } from './measures/page.ts';
import { readScene } from './measures/read.ts';
import { html } from './measures/render.ts';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { count } from '../packs/core/layouts/flow/count.js';

const ROOT = join(import.meta.dirname, '..');
/** The layouts measured unless named, and the views: today's flow and the three on the kit; the four views the owner judges by. */
export const LAYOUTS = ['core.flow', 'core.strips', 'core.rows', 'core.cola'];
export const VIEWS = ['built', 'principles', 'ias', 'study'];
/** How many times one item is added, each to a different item, to read how far the rest move. */
const ADDS = 3;

const arg = (name: string) => { const k = process.argv.indexOf(`--${name}`); return k > 0 ? process.argv[k + 1] : undefined; };
const layouts = (arg('layouts') ?? LAYOUTS.join(',')).split(',');
const views = (arg('views') ?? VIEWS.join(',')).split(',');
const mainRuns = join(ROOT, '..', '..', '..', 'runs', 'flow-replay');
const from = arg('from') ?? (existsSync(join(ROOT, 'runs', 'flow-replay', `${views[0]}.json`)) ? join(ROOT, 'runs', 'flow-replay') : mainRuns);
const to = arg('to') ?? join(ROOT, 'runs', 'layout-measures');
const pictures = !process.argv.includes('--no-pictures');
const house = JSON.parse(readFileSync(join(ROOT, 'packs', 'core', 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;

/** A replay's input with the house style's sizes added where its own style predates them, and its measure. */
function replay(name: string) {
  const kept = JSON.parse(readFileSync(join(from, `${name}.json`), 'utf8'));
  const input = { ...kept.input, style: { ...kept.input.style, sizes: { ...house.sizes, ...kept.input.style.sizes } } };
  const measureText = (words: string, px: number, font: string, as: any) => {
    const said = as?.case === 'upper' ? String(words).toUpperCase() : String(words);
    const key = `${as?.style === 'italic' ? 'italic ' : ''}${as?.weight === 600 ? 600 : 400} ${px}px ${font || 'system-ui'}|${said}`;
    const track = /^-?\d+(\.\d+)?em$/.test(as?.track ?? '') ? parseFloat(as.track) * px * [...said].length : 0;
    return (kept.widths[key] ?? [...said].length * px * 0.55) + track;
  };
  return { lens: String(kept.lens), input, measureText };
}

/** The answer with one more item, after `anchor` in the order, of its kind and on its island. */
function plusOne(answer: any, anchor: any, k: number) {
  const id = `e_added${k}`;
  const item = { ...anchor, id, title: 'One more step', body: '', status: 'todo', open: true, pending: undefined };
  return { ...answer, items: [...answer.items, item], links: [...answer.links, { id: `r_added${k}`, kind: 'depends_on', type: 'depends_on', from: id, to: anchor.id }] };
}

mkdirSync(to, { recursive: true });
const cola = async () => (await import('../ui/cola.module.min.js' as string)).default;
const done: View[] = views.map((name) => ({ name, lens: replay(name).lens, layouts: {} }));
const scenes: { file: string; page: string; size: number[] }[] = [];
for (const id of layouts) {
  const drawing = drawings.find((d) => d.id === id);
  if (!drawing) { for (const v of done) v.layouts[id] = { error: `no layout ${id} in any pack.json` }; continue; }
  await setOut(drawing, async (url) => {
    const { picture } = await import(url('index.js'));
    for (const v of done) {
      const { input, measureText } = replay(v.name);
      const tools = { measure: measureText, patch() {}, open() {}, frame: () => new Promise(() => {}), surface: () => null, cola };
      const px = { text: input.style.sizes.flow_text, stub: input.style.sizes.flow_stub_text };
      const draw = async (given: any) => {
        const t0 = performance.now(), drawn = await picture(given, tools);
        return { scene: drawn?.scene, ms: performance.now() - t0 };
      };
      try {
        const base = await draw(input), pic = readScene(base.scene, px), times = [base.ms];
        const shown = new Set(pic.boxes.map((b) => b.id)), anchors = input.answer.items.filter((i: any) => shown.has(i.id));
        const moves: any[] = [];
        for (let k = 1; k <= ADDS && anchors.length; k++) {
          const again = await draw({ ...input, answer: plusOne(input.answer, anchors[Math.floor((anchors.length * k) / (ADDS + 1))], k) });
          times.push(again.ms);
          moves.push(moved(pic, readScene(again.scene, px)));
        }
        const m = measure(pic, { gap: 2 * input.style.sizes.flow_wire_gap, seen: (lines) => count(lines).seen });
        const ms = times.sort((p, q) => p - q)[Math.floor(times.length / 2)];
        const avg = (key: 'mean' | 'share') => moves.reduce((s, x) => s + x[key], 0) / Math.max(1, moves.length);
        const file = `${v.name}-${id.replace(/^core\./, '')}.png`;
        v.layouts[id] = { m, moved: { mean: avg('mean'), share: avg('share') }, ms, ...(pictures && { png: file }) } as Drawn;
        if (pictures) scenes.push({ file, page: html(base.scene, input.style.sizes), size: [pic.width, pic.height] });
        console.log(`${v.name} ${id}: ${Math.round(ms)} ms`);
      } catch (e: any) {
        v.layouts[id] = { error: String(e?.message ?? e).split('\n')[0] };
        console.log(`${v.name} ${id}: failed, ${e?.message}`);
      }
    }
  });
}

if (pictures && scenes.length) {
  const tab = await open('about:blank');
  for (const s of scenes) {
    await tab.send('Emulation.setDeviceMetricsOverride', { width: Math.min(Math.ceil(s.size[0]), 4000), height: Math.min(Math.ceil(s.size[1]), 4000), deviceScaleFactor: 1, mobile: false });
    await tab.evaluate(`document.open(); document.write(${JSON.stringify(s.page)}); document.close(); true`);
    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(join(to, s.file), await tab.screenshot());
  }
  await tab.close();
}

const when = `${new Date().toISOString().slice(0, 16).replace('T', ' ')}, replays from ${from}.`;
const md = done.map(table).join('\n\n');
writeFileSync(join(to, 'measures.md'), `${md}\n`);
writeFileSync(join(to, 'measures.json'), JSON.stringify(done, null, 1));
writeFileSync(join(to, 'index.html'), page(done, when));
console.log(`\n${md}\n\n-> ${join(to, 'index.html')}`);
process.exit();
