// A layout stays still (task e_6z86je33): wherever the flow has a free choice of order it takes what was made first, so
// adding one item to an island moves as little as its order forces. Run alone: answers in, places out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { layout } from './layouts/flow/layout.js';

const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (t: string, px: number) => t.length * px * 0.5;
const run = (items: any[], links: any[]) => layout({ items, links, measure, sizes: house.sizes });

/** A number from a seed, the same each run. */
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

/** An island of `n` steps, each made after the one before it, with ids that sort in no order of their making. */
function island(n: number, seed: number) {
  const r = seeded(seed), made = (k: number) => new Date(Date.UTC(2026, 10, 1, 9, k)).toISOString();
  const id = (k: number) => `e_${((k * 7919 + seed * 104729) % 99991).toString(36).padStart(4, '0')}${k}`;
  const items = Array.from({ length: n }, (_, k) => ({ id: id(k), type: 'task', title: `Step ${k} of the work`, open: true, status: 'todo', created_at: made(k), updated_at: made(k) }));
  const links: any[] = [];
  for (let k = 1; k < n; k++) {
    links.push({ type: 'depends_on', from: id(k), to: id(Math.floor(r() * k)) });
    if (r() < 0.25 && k > 2) links.push({ type: 'depends_on', from: id(k), to: id(Math.floor(r() * k)) });
  }
  return { items, links, id, made };
}

/**
 * Of the steps both pictures hold, the pairs whose order turned: two side by side (in one row) in both whose left and
 * right swapped, or two one over the other (in one column) whose top and foot did; and how many steps are in such a
 * pair. A step pushed along by the room a new one takes keeps its order, and is not counted.
 */
function moved(was: any, now: any) {
  const ids = [...was.x.keys()].filter((id: string) => now.x.has(id) && !id.includes(':'));
  const span = (g: any, id: string, at: 'x' | 'y') => { const n = g.nodes.get(id), half = (at === 'x' ? n.w : n.h) / 2; return [g[at].get(id) - half, g[at].get(id) + half]; };
  const over = (g: any, a: string, b: string, at: 'x' | 'y') => { const [p, q] = [span(g, a, at), span(g, b, at)]; return p[0] < q[1] && q[0] < p[1]; };
  const side = (g: any, a: string, b: string, at: 'x' | 'y') => Math.sign(Math.round(g[at].get(a) - g[at].get(b)));
  let swapped = 0;
  const turned = new Set<string>();
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const [a, b] = [ids[i], ids[j]];
    for (const [at, across] of [['x', 'y'], ['y', 'x']] as const) {
      if (over(was, a, b, across) && over(now, a, b, across) && side(was, a, b, at) * side(now, a, b, at) < 0) (swapped++, turned.add(a), turned.add(b));
    }
  }
  return { steps: turned.size, swapped, of: ids.length };
}

/** The island drawn, then drawn again with one step made after all of it, depending on one already there. */
function addOne(n: number, seed: number) {
  const { items, links, id, made } = island(n, seed), r = seeded(seed * 31 + 7);
  const was = run(items, links);
  const added = { id: id(n), type: 'task', title: `Step ${n} of the work`, open: true, status: 'todo', created_at: made(n), updated_at: made(n) };
  // The answer sends what changed last first (src/query-flat.ts reads by updated_at): the new step leads it.
  const now = run([added, ...items], [{ type: 'depends_on', from: id(n), to: id(Math.floor(r() * n)) }, ...links]);
  return moved(was, now);
}

test('still: the same answer, sent in any order, is the same picture', () => {
  const { items, links } = island(14, 3);
  const at = (g: any) => items.map((i) => [g.x.get(i.id), g.y.get(i.id)]);
  assert.deepEqual(at(run([...items].reverse(), [...links].reverse())), at(run(items, links)));
});

test('still: where a step stands is by when it was made, whatever the ids say', () => {
  // The same island under other ids, made in the same order, is the same picture: an id has no say in any choice.
  for (const seed of [2, 5, 9]) {
    const one = island(16, seed), other = island(16, seed);
    const named = (id: string) => `e_${[...id].reverse().join('')}`;
    const renamed = { items: other.items.map((i) => ({ ...i, id: named(i.id) })), links: other.links.map((l) => ({ ...l, from: named(l.from), to: named(l.to) })) };
    const [a, b] = [run(one.items, one.links), run(renamed.items, renamed.links)];
    assert.deepEqual(one.items.map((i) => [b.x.get(named(i.id)), b.y.get(named(i.id))]), one.items.map((i) => [a.x.get(i.id), a.y.get(i.id)]), `island ${seed}`);
  }
});

test('still: one step added to an island keeps most islands just as they were', () => {
  // Where the search for fewest crossings picks another of its tries once a step is added, pairs turn: that is the
  // search's choice, not a free one. Before made-first, 6 of these 12 islands of 16 and 3 of these 10 of 30 kept every
  // pair; now 10 of 12 and 7 of 10 do (5 Nov 2026), and in those that do not, the steps in a turned pair are counted.
  for (const [size, many, least] of [[16, 12, 9], [30, 10, 6]]) {
    const seen = Array.from({ length: many }, (_, s) => addOne(size, s + 1)), still = seen.filter((m) => !m.swapped).length;
    assert.ok(still >= least, `islands of ${size} with no pair turned: ${still} of ${many} (steps in a turned pair: ${seen.map((m) => m.steps).join(' ')})`);
  }
});
