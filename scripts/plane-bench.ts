// How the canvas moves with many items on it, in a real browser, against a running server:
//   node scripts/plane-bench.ts [http://127.0.0.1:3100] [--items 2000] [--chain 100]
// A flow of that many steps (chains of work, each depending on the one before, some across) is drawn as the canvas
// draws it, then moved for two seconds each way: dragged with all of it in sight, dragged at a size that reads, and
// zoomed in and out with the wheel. For each, the time between frames (median, 95th percentile, the longest) and how
// many marks were drawn at the end.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
import { house } from '../test/layout-cases.ts';
import { layoutFor } from '../src/layouts.ts';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:3100';
const count = Number(args.includes('--items') ? args[args.indexOf('--items') + 1] : 2000);
const root = join(import.meta.dirname, '..');
const drawing = layoutFor({ dir: join(root, 'packs'), packs: [JSON.parse(readFileSync(join(root, 'packs', 'core', 'pack.json'), 'utf8'))] }, { shape: 'flow' }, []);

const quiet = { blocked: false, waits_on: [] as string[], sessions: 0, needs_you: false };
const within = { items: 0, work: 0, blocked: 0, waiting: 0, sessions: 0, tokens: { estimated: 0, used: 0 }, waits_on: {}, needs_you: 0, not_sent: 0 };
const id = (n: number) => `e_${String(n).padStart(8, '0')}`;
const items = [{ id: id(0), type: 'project', root: 'project', kind: 'work', title: 'A big map', status: 'active', open: true, place: 1, size: { work: 0, tokens: { estimated: 0, used: 0 } }, state: quiet, within }];
const links: Record<string, unknown>[] = [];
// Long chains: the flow's layout sifts each layer's order, which takes long on wide layers (not what is measured here).
const chain = Number(args.includes('--chain') ? args[args.indexOf('--chain') + 1] : 100);
for (let n = 1; n <= count; n++) {
  items.push({ id: id(n), type: 'task', root: 'task', kind: 'work', title: `Task ${n} of the map, with a name of some length`, status: n % 3 ? 'todo' : 'doing', open: n % 7 !== 0, inside: id(0), place: n, size: items[0].size, state: { ...quiet, blocked: n % 11 === 0, needs_you: n % 13 === 0 }, within } as (typeof items)[0]);
  if ((n - 1) % chain) links.push({ kind: 'depends_on', from: id(n), to: id(n - 1), n: 1 });
  if (n > chain && n % 17 === 0) links.push({ kind: 'depends_on', from: id(n), to: id(n - chain + 3), n: 1 });
}
const answer = { lens: { from: id(0), by: 'part_of', over: ['depends_on'], fold: ['system'] }, items, links, rest: {}, viewer: id(0), controls: [], views: [] };
const style = { ...house('flow'), noLit: true, drawing };

const bench = `async (answer, style) => {
  const { drawWith } = await import('/layout.js');
  const host = document.createElement('div');
  host.className = 'lens-view';
  host.style.cssText = 'width:1280px;height:860px';
  document.body.append(host);
  const t0 = performance.now();
  drawWith(host, answer, style, () => {});
  await new Promise((resolve) => { const done = () => (host.moves || host.querySelector('.lens-error')) && (seen.disconnect(), resolve(), true); const seen = new MutationObserver(done); if (!done()) seen.observe(host, { childList: true, subtree: true }); });
  const drawn = performance.now() - t0;
  if (!host.moves) return { failed: host.textContent, drawn };
  const stage = host.querySelector('.lf-stage'), moves = host.moves;
  const r = stage.getBoundingClientRect();
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const at = (x, y) => ({ clientX: r.left + x, clientY: r.top + y, pointerId: 1, button: 0, bubbles: true });
  /** Move it for ms, a step each frame, and say the time between frames. */
  const run = async (ms, stepAt) => {
    await frame(); await frame();
    const gaps = [];
    let last = performance.now(), n = 0;
    const end = last + ms;
    while (last < end) {
      stepAt(n++);
      const t = await frame();
      gaps.push(t - last);
      last = t;
    }
    gaps.sort((a, b) => a - b);
    const pick = (q) => Math.round(gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * q))] * 10) / 10;
    return { frames: gaps.length, median: pick(0.5), p95: pick(0.95), longest: pick(1), drawn: [...stage.querySelectorAll('svg > *')].filter((el) => el.getAttribute('display') !== 'none').length, text: stage.dataset.text };
  };
  const dragFor = (ms) => {
    stage.dispatchEvent(new PointerEvent('pointerdown', at(600, 400)));
    return run(ms, (n) => stage.dispatchEvent(new PointerEvent('pointermove', at(600 + 300 * Math.sin(n / 20), 400 + 200 * Math.cos(n / 20) - 200)))).then((got) => (stage.dispatchEvent(new PointerEvent('pointerup', at(600, 400))), got));
  };
  const out = { drawn: Math.round(drawn), marks: stage.querySelectorAll('svg *').length };
  moves.fit();
  out.fitted = { scale: moves.state().s, ...(await dragFor(2000)) };
  const [vx, vy, vw, vh] = stage.querySelector('svg').getAttribute('viewBox').split(' ').map(Number);
  const v = { x: vx, y: vy, width: vw, height: vh };
  moves.restore({ ...moves.state(), s: 1 });
  moves.show(v.x + v.width / 2, v.y + v.height / 2);
  out.readable = await dragFor(2000);
  moves.fit();
  out.zoom = await run(2000, (n) => stage.dispatchEvent(new WheelEvent('wheel', { deltaY: Math.sin(n / 15) * 40, clientX: r.left + 640, clientY: r.top + 430, bubbles: true, cancelable: true })));
  return out;
}`;

const page = await open(`${base}/`);
const got = await page.evaluate(`(${bench})(${JSON.stringify(answer)}, ${JSON.stringify(style)})`);
console.log(JSON.stringify(got, null, 1));
const errors = page.logs().filter((l) => /error/i.test(l));
if (errors.length) console.log(errors.slice(0, 5).join('\n'));
page.close();
process.exit(0);
