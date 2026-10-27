// Pictures of the flow drawing, in a real browser, against a running server, to look at:
//   node scripts/flow-shots.ts [http://127.0.0.1:3100] [out folder] [--packs <a packs folder>]
// Each flow case (test/drawing-cases.ts) drawn as the canvas draws it, at its width, and kept as a PNG; then two
// thousand steps (chains of 100, and of 20 in wide layers, as scripts/plane-bench.ts makes them). For each, what a
// reader meets: the steps, the wires and ties, where wires cross, their turns, where a wire passes through a step that
// is not its own, and how long until it was on the page. --packs draws with another copy of the packs (an older flow,
// to compare).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
import { flowCases } from '../test/drawing-cases.ts';
import { drawingFor } from '../src/drawings.ts';

const args = process.argv.slice(2);
const packs = args.includes('--packs') ? args.splice(args.indexOf('--packs'), 2)[1] : join(import.meta.dirname, '..', 'packs');
const base = args[0] ?? 'http://127.0.0.1:3100';
const out = args[1] ?? join(import.meta.dirname, '..', 'runs', 'flow-shots');
mkdirSync(out, { recursive: true });
const drawing = drawingFor({ dir: packs, packs: [JSON.parse(readFileSync(join(packs, 'core', 'pack.json'), 'utf8'))] }, { shape: 'flow' }, []);

/** Two thousand steps of work, part of one project, in chains each depending on the one before, some across. */
function big(chain: number) {
  const quiet = { blocked: false, waits_on: [] as string[], sessions: 0, needs_you: false };
  const within = { items: 0, work: 0, blocked: 0, waiting: 0, sessions: 0, tokens: { estimated: 0, used: 0 }, waits_on: {}, needs_you: 0, not_sent: 0 };
  const id = (n: number) => `e_${String(n).padStart(8, '0')}`;
  const items: Record<string, unknown>[] = [{ id: id(0), type: 'project', root: 'project', kind: 'work', title: 'A big map', status: 'active', open: true, place: 1, size: { work: 0, tokens: { estimated: 0, used: 0 } }, state: quiet, within }];
  const links: Record<string, unknown>[] = [];
  for (let n = 1; n <= 2000; n++) {
    items.push({ id: id(n), type: 'task', root: 'task', kind: 'work', title: `Task ${n} of the map, with a name of some length`, status: 'todo', open: n % 7 !== 0, inside: id(0), place: n, size: items[0].size, state: quiet, within });
    if ((n - 1) % chain) links.push({ kind: 'depends_on', from: id(n), to: id(n - 1), n: 1 });
    if (n > chain && n % 17 === 0) links.push({ kind: 'depends_on', from: id(n), to: id(n - chain + 3), n: 1 });
  }
  return { lens: { from: id(0), by: 'part_of', over: ['depends_on'], fold: ['system'] }, items, links, rest: {}, viewer: id(0), controls: [], views: [] };
}

const shot = `async (answer, style, width) => {
  const { drawWith } = await import('/drawing.js');
  const { dress } = await import('/lens-base.js');
  document.body.replaceChildren();
  const host = document.createElement('div');
  host.className = 'lens-view';
  host.style.width = width + 'px';
  document.body.append(host);
  dress(host, style);
  const t0 = performance.now();
  drawWith(host, answer, { ...style }, () => {});
  for (let n = 0; n < 800 && !host.querySelector('.lf-stage svg .lf-step') && !host.textContent.includes('stopped'); n++) await new Promise((r) => setTimeout(r, 25));
  if (!host.querySelector('.lf-stage svg .lf-step')) return { drawn: Math.round(performance.now() - t0), said: host.textContent.slice(0, 120) };
  const drawn = performance.now() - t0;
  // Clutter, read off the marks: wire segments that cross, turns, and wires that pass through a step not their own.
  const segs = [...host.querySelectorAll('svg[role=img] path.lf-wire')].map((p) => p.getAttribute('d').slice(1).split('L').map((q) => q.split(' ').map(Number)));
  const pieces = segs.flatMap((pts, w) => pts.slice(1).map((b, k) => ({ w, a: pts[k], b })));
  let crossings = 0;
  for (let i = 0; i < pieces.length && pieces.length <= 4000; i++) for (let j = i + 1; j < pieces.length; j++) {
    const [p, q] = [pieces[i], pieces[j]];
    if (p.w === q.w) continue;
    const ph = p.a[1] === p.b[1], qh = q.a[1] === q.b[1];
    if (ph === qh) continue;
    const [h, v] = ph ? [p, q] : [q, p];
    const [x1, x2] = [Math.min(h.a[0], h.b[0]), Math.max(h.a[0], h.b[0])], [y1, y2] = [Math.min(v.a[1], v.b[1]), Math.max(v.a[1], v.b[1])];
    if (v.a[0] > x1 + 0.5 && v.a[0] < x2 - 0.5 && h.a[1] > y1 + 0.5 && h.a[1] < y2 - 0.5) crossings++;
  }
  const turns = segs.reduce((s, pts) => s + pts.slice(1, -1).filter((p, k) => { const [a, b] = [pts[k], pts[k + 2]]; return !((a[0] === p[0] && p[0] === b[0]) || (a[1] === p[1] && p[1] === b[1])); }).length, 0);
  // A wire through a step: a stretch of it inside a step's box, other than the ends it leaves and reaches.
  const boxes = [...host.querySelectorAll('svg[role=img] .lf-step .lf-shape')].map((el) => el.getBBox());
  let through = 0;
  if (boxes.length <= 400) for (const p of pieces) for (const b of boxes) {
    const [x1, x2, y1, y2] = [Math.min(p.a[0], p.b[0]), Math.max(p.a[0], p.b[0]), Math.min(p.a[1], p.b[1]), Math.max(p.a[1], p.b[1])];
    if (x2 > b.x + 1 && x1 < b.x + b.width - 1 && y2 > b.y + 1 && y1 < b.y + b.height - 1) through++;
  }
  // Hovering the first step: its tip, as the page shows it.
  host.querySelector('svg[role=img] a.lf-step')?.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  for (let n = 0; n < 40 && !document.querySelector('.lf-tip'); n++) await new Promise((r) => setTimeout(r, 25));
  const tip = document.querySelector('.lf-tip')?.innerText.replace(/\\s+/g, ' ').slice(0, 90) ?? null;
  const svg = host.querySelector('.lf-stage svg[role=img]');
  return { drawn: Math.round(drawn), tip, steps: host.querySelectorAll('svg[role=img] .lf-step:not(.stub)').length, wires: segs.length, ties: host.querySelectorAll('svg[role=img] path.lf-tie').length, crossings: pieces.length <= 4000 ? crossings : null, turns, through: boxes.length <= 400 ? through : null, size: svg?.getAttribute('viewBox').split(' ').slice(2).map((v) => Math.round(Number(v))).join(' x ') };
}`;

const page = await open(`${base}/`);
const report: Record<string, unknown> = {};
try {
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1320, height: 900, deviceScaleFactor: 1, mobile: false });
  const style = flowCases()[0].style;
  const cases = [...flowCases().filter((c) => !c.name.endsWith('still')), { name: 'big, chains of 100', answer: big(100), style, width: 1280 }, { name: 'big, chains of 20', answer: big(20), style, width: 1280 }];
  for (const c of cases) {
    report[c.name] = await page.evaluate(`(${shot})(${JSON.stringify(c.answer)}, ${JSON.stringify({ ...c.style, drawing })}, ${c.width})`);
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(out, `${c.name.replaceAll(/[^a-z]+/g, '-')}.png`), await page.screenshot());
  }
} finally {
  page.close();
}
console.log(JSON.stringify(report, null, 1));
