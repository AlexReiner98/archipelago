/**
 * The field's physics, off the page: a map in, where its particles settle
 * out. 2000 items in 40 part_of trees with about 2700 links, like the map Field
 * was first tuned on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { build, seed, type FieldIn } from "../packs/field/graph.ts";
import { BEHAVIOURS, RUN, defaults, step } from "../packs/field/step.ts";
import { DRAW } from "../packs/field/paint.ts";

/** A seeded random, so the map is the same each run. */
function rand(s: number) {
  return () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
}

function sample(n = 2000, islands = 40): FieldIn {
  // "islands" here is only how many part_of trees the sample has: Field knows no groups.
  const r = rand(7);
  const items = Array.from({ length: n }, (_, i) => ({ id: `i${i}`, title: `item ${i}`, type: "work", status: "todo", closed: r() < 0.3 }));
  const links: FieldIn["links"] = [];
  for (let i = islands; i < n; i++) {
    // Each item is part of an earlier one in its island; some depend on another there; a few reach across.
    const parent = i - islands * (1 + Math.floor(r() * 3));
    links.push({ id: `p${i}`, type: "part_of", from: `i${i}`, to: `i${Math.max(i % islands, parent)}` });
    if (r() < 0.25) links.push({ id: `d${i}`, type: "depends_on", from: `i${i}`, to: `i${(i + islands) % n}` });
    if (r() < 0.1) links.push({ id: `a${i}`, type: "about", from: `i${i}`, to: `i${Math.floor(r() * n)}` });
  }
  return { items, links };
}

const dials = () => [
  { key: "seed_spread", value: 4.5 },
  ...BEHAVIOURS.flatMap((b) => b.dials({ links: ["part_of", "depends_on", "about"] })),
  ...RUN,
  ...DRAW,
];
const settings = () => defaults(dials() as never);

function settle(input: FieldIn, S = settings(), most = 4000) {
  const g = build(input, null);
  seed(g, S);
  const t0 = performance.now();
  let forces = 0;
  while (step(g, S) && g.sim.steps < most) if (g.sim.alpha >= S.alpha_min!) forces++;
  return { g, forces, steps: g.sim.steps, ms: performance.now() - t0 };
}

test("every number a behaviour reads is one of its dials", () => {
  for (const b of BEHAVIOURS) {
    const keys = new Set(b.dials({ links: ["part_of"] }).map((d) => d.key));
    assert.ok(keys.has(`w_${b.name}`), `${b.name} has its weight`);
    const src = String(b.apply) + String(b.move ?? "");
    for (const m of src.matchAll(/S\.(\w+)/g)) {
      const k = m[1]!;
      const known = keys.has(k) || dials().some((d) => d.key === k);
      assert.ok(known, `${b.name} reads ${k}, which is a dial`);
    }
  }
});

test("2000 items settle in about 460 steps, a few ms each, the same way twice", () => {
  const input = sample();
  const a = settle(input);
  console.log(`settled: ${a.forces} force steps, ${a.steps} in all, ${a.ms.toFixed(0)} ms (${(a.ms / a.steps).toFixed(1)} ms a step)`);
  assert.ok(a.forces > 400 && a.forces < 520, `${a.forces} force steps`);
  assert.ok(a.ms / a.steps < 40, `${(a.ms / a.steps).toFixed(1)} ms a step`);
  const small = sample(300, 8);
  assert.deepEqual([...settle(small).g.x], [...settle(small).g.x], "the same answer settles the same way");
});

test("collide leaves no particle on another, and part_of keeps a tree together", () => {
  const { g } = settle(sample(600, 12));
  let overlaps = 0;
  for (let i = 0; i < g.n; i++) for (let j = i + 1; j < g.n; j++) if (Math.hypot(g.x[i]! - g.x[j]!, g.y[i]! - g.y[j]!) < (g.r[i]! + g.r[j]!) * 0.9) overlaps++;
  assert.ok(overlaps <= g.n * 0.01, `${overlaps} overlaps`);
  // A part_of link ends up shorter than the average distance between any two particles.
  let part = 0, parts = 0, any = 0;
  for (let e = 0; e < g.m; e++) if (g.linkKinds[g.kind[e]!] === "part_of") (part += Math.hypot(g.x[g.a[e]!]! - g.x[g.b[e]!]!, g.y[g.a[e]!]! - g.y[g.b[e]!]!)), parts++;
  for (let i = 0; i < 200; i++) any += Math.hypot(g.x[i]! - g.x[599 - i]!, g.y[i]! - g.y[599 - i]!);
  assert.ok(part / parts < (any / 200) / 3, `${(part / parts).toFixed(0)} against ${(any / 200).toFixed(0)}`);
});
