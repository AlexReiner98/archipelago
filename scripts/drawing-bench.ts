// How fast a picture drawn by a drawing is, in a real browser, against a running server:
//   node scripts/drawing-bench.ts [http://127.0.0.1:3100]
// For each picture: the first on a page that has started nothing, the first on a page whose frame was started while
// the answer was on its way (as the lens view does), and one more by the same drawing; how long the page's own thread
// was held; and how long a hover takes to come back. The drawing is the core pack's architecture, as the server sends it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { open } from '../test/browser.ts';
import { architectureCases, bigSystem, house } from '../test/drawing-cases.ts';
import { drawingFor } from '../src/drawings.ts';

const base = process.argv[2] ?? 'http://127.0.0.1:3100';
const root = join(import.meta.dirname, '..');
const drawing = drawingFor({ dir: join(root, 'packs'), packs: [JSON.parse(readFileSync(join(root, 'packs', 'core', 'pack.json'), 'utf8'))] }, { shape: 'architecture' }, []);

const pictures = { hero: architectureCases()[0].answer, system: architectureCases()[3].answer, big: bigSystem() };
const style = { ...house('architecture'), noLit: true, drawing };

/** In the page: draw one picture and say how long until it was on the page, and the longest the page's thread was held. */
const once = `async (answer, style, warm) => {
  const { drawWith, warmDrawings } = await import('/drawing.js');
  if (warm) (warmDrawings(), await new Promise((r) => setTimeout(r, 150)));
  let held = 0;
  const watch = new PerformanceObserver((list) => list.getEntries().forEach((e) => (held = Math.max(held, e.duration))));
  watch.observe({ type: 'longtask' });
  const host = document.createElement('div');
  host.className = 'lens-view';
  host.style.width = '1100px';
  document.body.append(host);
  const t0 = performance.now();
  drawWith(host, answer, { ...style }, () => {});
  await new Promise((resolve) => { const seen = new MutationObserver(() => host.querySelector('.lf-stage') && (seen.disconnect(), host.getBoundingClientRect(), resolve())); seen.observe(host, { childList: true, subtree: true }); });
  const drawn = performance.now() - t0;
  // A hover, there and back.
  const part = host.querySelector('.lf-stage a.ar-part');
  const t1 = performance.now();
  part.dispatchEvent(new MouseEvent('mouseenter'));
  await new Promise((resolve) => { const seen = new MutationObserver(() => host.querySelector('.lit') && (seen.disconnect(), resolve())); seen.observe(host, { attributes: true, subtree: true }); });
  const hover = performance.now() - t1;
  await new Promise((r) => setTimeout(r, 50));
  watch.disconnect();
  return { drawn: Math.round(drawn), hover: Math.round(hover), held: Math.round(held), marks: host.querySelectorAll('*').length };
}`;

for (const [name, answer] of Object.entries(pictures)) {
  const runs: Record<string, unknown>[] = [];
  for (let n = 0; n < 3; n++) {
    for (const warm of [false, true]) {
      const page = await open(`${base}/`);
      const first = await page.evaluate(`(${once})(${JSON.stringify(answer)}, ${JSON.stringify(style)}, ${warm})`);
      const second = await page.evaluate(`(${once})(${JSON.stringify(answer)}, ${JSON.stringify(style)}, false)`);
      runs.push({ warm, first, second });
      page.close();
    }
  }
  const median = (pick: (r: any) => number) => runs.map(pick).sort((a, b) => a - b)[Math.floor(runs.length / 2)];
  const of = (warm: boolean) => runs.filter((r) => r.warm === warm);
  const med = (list: any[], pick: (r: any) => number) => list.map(pick).sort((a, b) => a - b)[Math.floor(list.length / 2)];
  console.log(
    `${name.padEnd(7)} ${String((runs[0].first as any).marks).padStart(5)} marks | first, cold: ${med(of(false), (r) => r.first.drawn)} ms | first, frame started: ${med(of(true), (r) => r.first.drawn)} ms | again: ${median((r) => r.second.drawn)} ms | hover: ${median((r) => r.second.hover)} ms | page held at most: ${median((r) => r.second.held)} ms`,
  );
}
process.exit(0);
