// The topology of a wired drawing: a graph embedded so every wire runs one way through the numbers, whatever it is tightened to.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a drawing's modules are plain JavaScript
import { against, downward, sidesOf } from './draw/flow/topology.js';
// @ts-expect-error a drawing's modules are plain JavaScript
import { embed } from './draw/flow/upward.js';

const Z = { trial_most: 100, number_tries: 3, embed_most: 30, embed_big: 300, embed_cost: 2 };

/** A graph of `n` items in layers, every link down them, with ties across: what a repository's map looks like. */
function layered(n: number, seed: number) {
  let s = seed;
  const noise = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296, items = Array.from({ length: n }, (_, k) => `i${k}`), links: [string, string, number][] = [];
  for (let k = 1; k < n; k++) {
    links.push([`i${Math.floor(noise() * k)}`, `i${k}`, 3]);
    if (noise() < 0.6) {
      const other = Math.floor(noise() * k);
      if (!links.some(([a, b]) => a === `i${other}` && b === `i${k}`)) links.push([`i${other}`, `i${k}`, noise() < 0.5 ? 2 : 1]);
    }
  }
  return { items, links };
}

/** Each stretch on two faces, each face with one top and one foot, each point on a wire and numbered, and nothing left over. */
function sound(g: any) {
  const seen = new Map<string, number>(), near = new Map<string, Set<string>>(), key = (a: string, b: string) => [a, b].sort().join('|');
  for (const f of g.faces) f.forEach((a: string, k: number) => {
    const b = f[(k + 1) % f.length], e = key(a, b), [x, y, z] = [g.number.get(f.at(k - 1)), g.number.get(a), g.number.get(b)];
    seen.set(e, (seen.get(e) ?? 0) + 1);
    assert.ok(y !== undefined && x !== y && y !== z, `${a} has a number of its own`);
  });
  for (const f of g.faces) {
    const n = f.length, turns = (sign: number) => f.filter((v: string, k: number) => Math.sign(g.number.get(f[(k + 1) % n]) - g.number.get(v)) === sign && Math.sign(g.number.get(f[(k + n - 1) % n]) - g.number.get(v)) === sign).length;
    assert.equal(turns(1), 1, `one top: ${f.join(' ')}`);
    assert.equal(turns(-1), 1, `one foot: ${f.join(' ')}`);
  }
  for (const [e, n] of seen) assert.equal(n, 2, `${e} between two faces`);
  assert.deepEqual([...seen.keys()].sort(), [...g.owner.keys()].sort());
  for (const k of g.owner.keys()) {
    const [a, b] = k.split('|');
    (near.get(a) ?? near.set(a, new Set()).get(a)!).add(b);
    (near.get(b) ?? near.set(b, new Set()).get(b)!).add(a);
  }
  assert.deepEqual([...near.keys()].sort(), [...g.number.keys()].sort(), 'no number outlives its point');
  for (const [v, s] of near) {
    const later = [...s].some((w) => g.number.get(w) > g.number.get(v)), earlier = [...s].some((w) => g.number.get(w) < g.number.get(v));
    if (v !== g.s) assert.ok(earlier, `${v} has a wire in`);
    if (v !== g.t) assert.ok(later, `${v} has a wire out`);
  }
  for (const w of g.wires) {
    w.path.slice(1).forEach((v: string, i: number) => assert.equal(g.owner.get(key(w.path[i], v)), w, `${w.path[i]} to ${v} is held`));
    const steps = w.path.slice(1).map((v: string, i: number) => Math.sign(g.number.get(v) - g.number.get(w.path[i])));
    assert.equal(new Set(steps).size, 1, `${w.path.join(' ')} runs one way`);
  }
  sidesOf(g.faces, g.outerAt, g.number, g.s, g.t);
}

test('topology: the embedding runs every order wire down, and stays sound once tightened', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) for (const n of [12, 40, 90]) {
    const { items, links } = layered(n, seed), g: any = embed(links, items);
    assert.equal(g.unthreaded, 0);
    assert.equal(against(g, g.number), 0, `${n} items, seed ${seed}`);
    assert.ok(g.wires.filter((w: any) => w.visible).length === links.length, 'every link drawn once');
    sound(g);
  }
});

test('topology: the embedding keeps each wire to its own link, from its first end', () => {
  const { items, links } = layered(40, 9), g: any = embed(links, items);
  for (const w of g.wires.filter((x: any) => x.visible)) assert.deepEqual([w.path[0], w.path.at(-1)], [w.link[0], w.link[1]]);
});

test('topology: a part past the trials takes the embedding and reads all down', () => {
  const { items, links } = layered(60, 11), made = downward(links, items, { ...Z, trial_most: 50 });
  assert.equal(against(made.g, made.number), 0);
  sound({ ...made.g, number: made.number, s: made.s, t: made.t, outerAt: made.outerAt });
});

test('topology: a ring keeps its one link out of the order and the rest down', () => {
  const links: [string, string, number][] = [['a', 'b', 2], ['b', 'c', 2], ['c', 'd', 2], ['d', 'a', 0]], g: any = embed(links, ['a', 'b', 'c', 'd']);
  assert.equal(against(g, g.number), 0);
});

test('topology: the same links draw the same graph', () => {
  const { items, links } = layered(70, 13), [p, q]: any[] = [embed(links, items), embed(links, items)];
  assert.deepEqual([...p.number], [...q.number]);
  assert.deepEqual(p.faces, q.faces);
});
