// The map's starts spread over helpers draw the picture they drew one after another (task e_bsp7jhrw): every canvas
// of the corpus (corpus/) drawn with helpers that answer out of order, in a module copy of their own as a worker
// would be, each start sent and answered as a copy (structured clone), is the picture its hash says, after the same
// number of starts and with the same winner. Input in, marks out: no database, no browser.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
/** The drawing's modules in a folder of their own: one for the drawing, one for its helpers, as two workers have. */
const copy = async () => {
  const laid = mkdtempSync(join(tmpdir(), 'pelago-map-spread-'));
  for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
  const at = (name: string) => import(pathToFileURL(join(laid, name)).href);
  return { layout: await at('layout.js'), spread: await at('spread.js'), stage: await at('stage.js') };
};
const here = await copy(), away = await copy();
const measure = (t: string, px: number) => t.length * px * 0.55;
const corpus = join(import.meta.dirname, 'corpus');
const canvases = readdirSync(corpus).filter((f) => f.endsWith('.json')).sort();

/** Helpers that answer each start after a turn or two, so later starts often come back first. */
const pool = (size: number, seed: number) => {
  let r = seed, asked = 0;
  const later = () => new Promise((resolve) => { r = (r * 16807) % 2147483647; let n = r % 4; const go = () => (n-- ? setImmediate(go) : resolve(null)); go(); });
  return {
    size,
    asked: () => asked,
    run: async (name: string, arg: unknown, at: number) => {
      assert.ok(at >= 0 && at < size, `helper ${at}`);
      asked++;
      const said = structuredClone(arg);
      await later();
      return structuredClone(away.spread.helpers[name](said));
    },
  };
};

const hashOf = (g: any) => createHash('sha1').update(JSON.stringify([[...g.x], [...g.y], g.chains.map((p: any) => p.points), g.ties.map((p: any) => p.points)])).digest('hex').slice(0, 12);

test('each canvas is drawn as it was, its starts spread over helpers', async () => {
  const moved: string[] = [];
  let spread = 0;
  for (const f of canvases) {
    const { picture: _p, ...answer } = JSON.parse(readFileSync(join(corpus, f), 'utf8'));
    const args = { items: answer.items, links: answer.links, undrawn: house.undrawn, measure, sizes: house.sizes };
    let counts: any;
    here.stage.stages((name: string, s: any) => name === 'planarized' && (counts = s.counts));
    const alone = here.layout.layout(args), one = { hash: hashOf(alone), counts };
    for (const [size, seed] of [[1, 7], [3, 11], [6, 13]]) {
      const helpers = pool(size, seed);
      const g = await here.spread.spreading((_: unknown, _t: unknown) => here.layout.layout(args))({}, { helpers });
      if (helpers.asked()) spread++;
      const now = { hash: hashOf(g), counts };
      if (now.hash !== one.hash || now.counts.starts !== one.counts.starts || now.counts.tried !== one.counts.tried) moved.push(`${f} with ${size}: ${JSON.stringify(one.counts)} → ${JSON.stringify(now.counts)}`);
    }
  }
  here.stage.stages(null);
  assert.deepEqual(moved, [], `pictures moved:\n${moved.join('\n')}`);
  assert.ok(spread >= 6, `only ${spread} pictures spread their starts`);
});

test('a canvas whose first start is final asks no helper', async () => {
  const { picture: _p, ...answer } = JSON.parse(readFileSync(join(corpus, 'decisions-30.json'), 'utf8'));
  const args = { items: answer.items, links: answer.links, undrawn: house.undrawn, measure, sizes: house.sizes };
  const helpers = pool(3, 5), g = here.spread.spreading(() => here.layout.layout(args))({}, { helpers });
  assert.ok(!(g instanceof Promise), 'drawn at once');
  assert.equal(helpers.asked(), 0);
});

test('a helper that fails leaves the picture drawn one start after another', async () => {
  const { picture: _p, ...answer } = JSON.parse(readFileSync(join(corpus, 'hub-depends-23.json'), 'utf8'));
  const args = { items: answer.items, links: answer.links, undrawn: house.undrawn, measure, sizes: house.sizes };
  const broken = { size: 2, run: async () => { throw new Error('stopped'); } };
  const g = await here.spread.spreading(() => here.layout.layout(args))({}, { helpers: broken });
  assert.equal(hashOf(g), hashOf(here.layout.layout(args)));
});
