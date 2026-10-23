// A system as it came to be (draw/architecture/story.js, play.js): the lens's steps, each laid out with the one
// before it as its prior. Checked on the landing page's story (14 steps, as the prototype told it on 22 Oct 2026)
// for what a reader follows it by: no two wires run as one, few cross and few turn, a corner stays square in every
// frame of a move, what a step leaves alone does not move, and the last step is the map as it is.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { picture } from './draw/architecture/index.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { layout } from './draw/architecture/layout.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { nameLeft, squareMorph, statesOf } from './draw/architecture/story.js';

const house = { ...JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props, shape: 'architecture' };
const answer = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'drawings', 'architecture-story.json'), 'utf8'));
const measure = (t: string, px: number) => t.length * px * 0.56;
const run = (steady = true) => {
  let prior: any;
  return statesOf(answer).map((s: any) => {
    const g = layout({ items: s.items, links: s.links, rootId: answer.lens.from, measure, sizes: house.sizes, prior, steady });
    prior = g.memo;
    return { s, g };
  });
};
const frames = run();

/** Runs of two wires closer than 6 units for more than 2: read as one wire. */
function overlaps(g: any) {
  const runs = g.chains.flatMap((c: any) => c.points.slice(1).map((q: number[], k: number) => ({ c: c.key, p: c.points[k], q })).filter(({ p, q }: any) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5));
  const out: string[] = [];
  for (let i = 0; i < runs.length; i++)
    for (let j = i + 1; j < runs.length; j++) {
      const [a, b] = [runs[i], runs[j]];
      if (a.c === b.c) continue;
      const av = Math.abs(a.p[0] - a.q[0]) < 0.5, bv = Math.abs(b.p[0] - b.q[0]) < 0.5;
      if (av !== bv) continue;
      const [ax, ay] = av ? [0, 1] : [1, 0];
      if (Math.abs(a.p[ax] - b.p[ax]) >= 6) continue;
      const lo = Math.max(Math.min(a.p[ay], a.q[ay]), Math.min(b.p[ay], b.q[ay])), hi = Math.min(Math.max(a.p[ay], a.q[ay]), Math.max(b.p[ay], b.q[ay]));
      if (hi - lo > 2) out.push(`${a.c} / ${b.c}`);
    }
  return out;
}
/** A turn: two runs in a row, one down and one across. */
const turnsOf = (pts: number[][]) => {
  const runs = pts.slice(1).map((q, k) => [pts[k], q]).filter(([p, q]) => Math.hypot(q[0] - p[0], q[1] - p[1]) > 0.5).map(([p, q]) => (Math.abs(p[0] - q[0]) < 0.5 ? 'v' : 'h'));
  return runs.slice(1).filter((r, k) => r !== runs[k]).length;
};

test('no two wires run as one, in any step', () => {
  frames.forEach(({ g }, k) => assert.deepEqual(overlaps(g), [], `step ${k + 1}`));
});

test('wires cross and turn no more than they did when the layout was chosen', () => {
  const crossings = frames.reduce((s, { g }) => s + g.breaks.length, 0);
  const turns = frames.reduce((s, { g }) => s + g.chains.reduce((t: number, c: any) => t + turnsOf(c.points), 0), 0);
  assert.ok(crossings <= CROSSINGS, `${crossings} crossings over the steps, over ${CROSSINGS}`);
  assert.ok(turns <= TURNS, `${turns} turns over the steps, over ${TURNS}`);
});
// As laid out on 22 Oct 2026 (the prototype: 49 and 452). Lower these when a change brings them down; never raise them.
const CROSSINGS = 43, TURNS = 452;

test('a corner stays square in every frame of a move', () => {
  for (let k = 1; k < frames.length; k++)
    for (const c of frames[k].g.chains) {
      const old = frames[k - 1].g.chains.find((o: any) => o.key === c.key);
      if (!old) continue;
      const [A, B] = squareMorph(old.points, c.points);
      for (let s = 0; s <= 20; s++) {
        const e = s / 20, pts = A.map((p: number[], i: number) => [p[0] + (B[i][0] - p[0]) * e, p[1] + (B[i][1] - p[1]) * e]);
        assert.ok(!pts.some((p: number[], i: number) => i && Math.abs(p[0] - pts[i - 1][0]) > 0.01 && Math.abs(p[1] - pts[i - 1][1]) > 0.01), `step ${k + 1}, ${c.key}, at ${e}`);
      }
    }
});

test('laid out again from itself, a step moves nothing', () => {
  for (const { s, g } of frames) {
    const again = layout({ items: s.items, links: s.links, rootId: answer.lens.from, measure, sizes: house.sizes, prior: g.memo, steady: true });
    for (const id of g.nodes.keys()) assert.deepEqual([Math.round(again.x.get(id)), Math.round(again.y.get(id))], [Math.round(g.x.get(id)), Math.round(g.y.get(id))], id);
  }
});

test('places keep their order, and a part its row, from one step to the next unless a wire forces it', () => {
  for (let k = 1; k < frames.length; k++) {
    const [was, now] = [frames[k - 1].g.memo, frames[k].g.memo];
    const kept = was.order.filter((c: string) => now.order.includes(c));
    assert.deepEqual(now.order.filter((c: string) => kept.includes(c)), kept, `step ${k + 1}: places reordered`);
  }
});

test('the last step is the map as it is: what is retired is gone, and titles and fields are its own', () => {
  const last = frames.at(-1)!.s;
  for (const i of answer.items) assert.equal(last.ids.has(i.id), i.open !== false, i.title);
  for (const i of last.items) assert.equal(i.title, answer.items.find((a: any) => a.id === i.id).title);
  assert.equal(last.flags.size, 0);
});

test('with less motion asked for, it is the last step at once, and all that was said', async () => {
  const sent: any[] = [];
  const { scene, end } = picture({ answer, style: house, reduced: true }, { measure, patch: (l: any[]) => sent.push(...l), frame: () => Promise.resolve(0), open: () => {} });
  // Once the scene is on the page.
  assert.equal(sent.length, 0);
  await new Promise((r) => setTimeout(r, 10));
  end();
  assert.ok(scene.before && scene.aside && scene.svg);
  assert.equal(sent.find((p) => p.key === 'count')?.text, '341 of 341');
  assert.equal(sent.filter((p) => p.append).length, answer.steps.reduce((n: number, s: any) => n + (s.lines?.length ?? 0) + (s.chapter ? 1 : 0), 0));
  const shown = new Set(sent.filter((p) => p.key?.startsWith('p:') && p.key.split(':').length === 2 && p.set?.opacity === 1).map((p) => p.key.slice(2)));
  assert.deepEqual([...shown].sort(), answer.items.filter((i: any) => i.open !== false && i.fields).map((i: any) => i.id).sort());
});

test('it lays out all its steps quickly', () => {
  const t0 = performance.now();
  for (let n = 0; n < 5; n++) run();
  assert.ok((performance.now() - t0) / 5 < 200, 'over 200 ms to lay out the story');
});

test('a story whose parts are not shown says so, and draws no picture of nothing', () => {
  const none = { ...answer, items: answer.items.filter((i: any) => i.id === answer.lens.from), links: [] };
  assert.deepEqual(picture({ answer: none, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene, { message: 'Nothing here is part of a system.' });
});

test('a place’s name sits where no wire of the step comes in across it, wherever the place has room', () => {
  const z = (k: string) => house.sizes[`arch_${k}`];
  let crossed = 0;
  for (const { g } of frames) {
    const wires = g.chains.map((c: any) => c.points);
    for (const b of g.boxes) {
      const inset = z('place_name_inset'), width = measure(b.item.title, z('place_text')) + z('place_name_room') - inset, top = b.y, bottom = b.y + inset + z('place_name_height');
      const at = nameLeft(b.x + inset, width, b.x + b.w - inset, top, bottom, wires, inset);
      assert.ok((at >= b.x + inset - 1e-6 && at + width <= b.x + b.w - inset + 1e-6) || at === b.x + inset, `${b.item.title}: inside its place`);
      if (wires.some((p: number[][]) => p.some((q, k) => k > 0 && Math.max(p[k - 1][1], q[1]) >= top && Math.min(p[k - 1][1], q[1]) <= bottom && Math.max(p[k - 1][0], q[0]) > at && Math.min(p[k - 1][0], q[0]) < at + width))) crossed++;
    }
  }
  // Where a place is narrower than its name beside a wire through it, the name stays at its corner: none more than now.
  assert.ok(crossed <= 3, `${crossed} names crossed by a wire`);
});
