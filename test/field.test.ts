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

test("the legend's filter: what it hides, and how it counts", async () => {
  const { shown, facets, toggle } = await import("../packs/field/filter.ts");
  const input: FieldIn = {
    items: [
      { id: "a", title: "a", type: "work", status: "todo", closed: false, kind: "feature" },
      { id: "b", title: "b", type: "work", status: "done", closed: true },
      { id: "c", title: "c", type: "question", status: "open", closed: false },
      { id: "d", title: "d", type: "record", status: "current", closed: false },
    ],
    links: [
      { id: "l1", type: "part_of", from: "b", to: "a" },
      { id: "l2", type: "about", from: "c", to: "a" },
    ],
  };
  const ids = (h: Parameters<typeof shown>[1]) => [...shown(input, h).items].sort().join("");
  assert.equal(ids({}), "abcd");
  assert.equal(ids({ types: ["work"] }), "cd");
  assert.equal(ids({ statuses: ["work:done"] }), "acd");
  assert.equal(ids({ kinds: ["work:no kind"] }), "acd");
  assert.equal(ids({ closed: true }), "acd");
  assert.equal(ids({ lone: true }), "abc");
  // A link shows only with both ends, and its type not hidden.
  assert.deepEqual([...shown(input, { types: ["question"] }).links], ["l1"]);
  assert.deepEqual([...shown(input, { links: ["part_of"] }).links], ["l2"]);
  const f = facets(input, { closed: true });
  assert.deepEqual([f.items.shown, f.items.n], [3, 4]);
  assert.deepEqual(f.types.find((t) => t.name === "work")?.statuses.map((s) => [s.name, s.n, s.shown]), [["done", 1, 0], ["todo", 1, 1]]);
  assert.deepEqual([f.lone.n, f.closed.shown], [1, 0]);
  // Switching twice is no change, and an emptied list goes.
  assert.deepEqual(toggle(toggle({}, "types", "work"), "types", "work"), {});
  assert.deepEqual(toggle({ lone: true }, "lone"), {});
});

test("titles: no two overlap, none leaves the view, none covers a particle, the budget holds", async () => {
  const { place } = await import("../packs/field/labels.ts");
  // A crowd of particles on a 400 x 300 view, each wanting a 80 x 14 title.
  const r = rand(3);
  const dots = Array.from({ length: 120 }, (_, i) => ({ i, x: 20 + r() * 360, y: 20 + r() * 260, r: 3 }));
  const covers = (b: [number, number, number, number], i: number) =>
    dots.some((d) => d.i !== i && Math.hypot(d.x - Math.max(b[0], Math.min(d.x, b[2])), d.y - Math.max(b[1], Math.min(d.y, b[3]))) < d.r);
  const at = { width: 400, height: 300, room: 4000, most: 100, gap: 4, covers };
  const placed = place(dots.map((d) => ({ ...d, w: 80, h: 14 })), at);
  assert.ok(placed.length > 0 && placed.length <= 30, `${placed.length} placed, budget 30`);
  for (const [k, a] of placed.entries()) {
    const [x0, y0, x1, y1] = a.box;
    assert.ok(x0 >= 0 && y0 >= 0 && x1 <= 400 && y1 <= 300, "inside the view");
    assert.ok(!covers(a.box, a.i), "covers no other particle");
    for (const b of placed.slice(k + 1)) assert.ok(!(x0 < b.box[2] && x1 > b.box[0] && y0 < b.box[3] && y1 > b.box[1]), "no overlap");
  }
  // A title that must show (the particle pointed at) is placed even over particles, and first.
  const must = place([{ i: 0, x: 200, y: 150, r: 3, w: 80, h: 14, must: true }], { ...at, covers: () => true });
  assert.equal(must.length, 1);
  // Near the right edge, a title goes left instead of off the view.
  const edge = place([{ i: 0, x: 390, y: 150, r: 3, w: 80, h: 14 }], { ...at, covers: () => false });
  assert.ok(edge[0]!.box[2] <= 400 && edge[0]!.box[0] < 390);
  // Nothing goes under what the view keeps clear (the legend).
  const legend: [number, number, number, number] = [0, 200, 200, 300];
  for (const p of place(dots.map((d) => ({ ...d, w: 80, h: 14 })), { ...at, clear: [legend] }))
    assert.ok(!(p.box[0] < legend[2] && p.box[2] > legend[0] && p.box[1] < legend[3] && p.box[3] > legend[1]), "clear of the legend");
  // A particle wider than its title holds it inside.
  const big = place([{ i: 0, x: 200, y: 150, r: 50, w: 80, h: 14, inside: true }], { ...at, covers: () => true });
  assert.equal(big[0]?.within, true);
});

test("a type keeps its colour whatever the filter hides", async () => {
  const { facets } = await import("../packs/field/filter.ts");
  const item = (id: string, type: string) => ({ id, title: id, type, status: "", closed: false });
  const whole: FieldIn = { items: [item("a", "actor"), item("b", "branch"), item("w", "work")], links: [], types: ["actor", "branch", "work"] };
  const pal = ["red", "blue", "yellow"];
  const colourOf = (g: ReturnType<typeof build>, type: string) => g.types[g.typeIx[g.idIx.get(type === "work" ? "w" : "b")!]!]!.colour;
  const all = build(whole, null, pal);
  // The filter leaves out actor: work and branch keep their colours.
  const less = build({ ...whole, items: whole.items.filter((it) => it.type !== "actor") }, null, pal);
  assert.equal(colourOf(less, "work"), colourOf(all, "work"));
  assert.equal(colourOf(less, "branch"), colourOf(all, "branch"));
  // The legend gives the same colours.
  const f = facets(whole, { types: ["actor"] }, pal);
  assert.equal(f.types.find((t) => t.name === "work")?.colour, colourOf(all, "work"));
});
