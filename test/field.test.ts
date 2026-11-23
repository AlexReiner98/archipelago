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
import { CHECK, descends } from "../packs/field/descends.ts";
import { FIND } from "../packs/field/filter.ts";

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
  ...FIND,
];
const settings = () => defaults(dials() as never);

function settle(input: FieldIn, S = settings()) {
  const g = build(input, null);
  seed(g, S);
  const t0 = performance.now();
  while (step(g, S));
  return { g, steps: g.sim.steps, ms: performance.now() - t0 };
}

test("every number a behaviour reads is one of its dials", () => {
  for (const b of BEHAVIOURS) {
    const keys = new Set(b.dials({ links: ["part_of"] }).map((d) => d.key));
    assert.ok(keys.has(`w_${b.name}`), `${b.name} has its weight`);
    const src = String(b.apply) + String(b.energy);
    for (const m of src.matchAll(/S\.(\w+)/g)) {
      const k = m[1]!;
      const known = keys.has(k) || dials().some((d) => d.key === k);
      assert.ok(known, `${b.name} reads ${k}, which is a dial`);
    }
  }
});

/** One settled sample of 600, shared: settling is the slow part (seconds on a slow runner), and both tests below read it. */
let settled600: ReturnType<typeof settle> | undefined;
const big = () => (settled600 ??= settle(sample(600, 15)));

test("a run settles where the pushes balance, not where it cooled, and the same way twice", () => {
  const a = big();
  console.log(`settled: ${a.steps} steps, ${a.ms.toFixed(0)} ms (${(a.ms / a.steps).toFixed(1)} ms a step), moving ${a.g.sim.moved!.toFixed(3)} a step`);
  assert.equal(a.g.sim.settled, true, "it settled before steps_most");
  assert.ok(a.g.sim.push! < settings().settle_push!, "the pushes balance");
  assert.ok(a.ms / a.steps < 40, `${(a.ms / a.steps).toFixed(1)} ms a step`);
  const small = sample(300, 8);
  assert.deepEqual([...settle(small).g.x], [...settle(small).g.x], "the same answer settles the same way");
});

test("the rule: every behaviour's push is its energy's slope, and the energy only falls", () => {
  const S = settings();
  const g = build(sample(200, 8), null);
  seed(g, S);
  for (let k = 0; k < 30; k++) step(g, S);
  const gather = BEHAVIOURS.find((b) => b.name === "gather")!;
  for (const b of BEHAVIOURS) {
    const v = descends(b, g, S, gather);
    assert.ok(v.slope <= CHECK.slope_off, `${b.name}: its push is off its energy's slope by ${(v.slope * 100).toFixed(1)}%`);
    assert.equal(v.rises, 0, `${b.name}: its energy rose at step ${v.firstRise}`);
    assert.ok(v.to < v.from, `${b.name}: its energy fell`);
  }
  // A behaviour that breaks the rule is caught: a push with no energy behind it.
  const spin = { ...gather, name: "spin", energy: () => 0, apply: (gg: typeof g, f: { x: Float32Array; y: Float32Array }) => { for (let i = 0; i < gg.n; i++) (f.x[i]! -= gg.y[i]! * 0.01), (f.y[i]! += gg.x[i]! * 0.01); } };
  assert.equal(descends(spin, g, S, gather).ok, false, "a push that is no energy's slope fails");
});

test("collide leaves no particle on another, and part_of keeps a tree together", () => {
  const { g } = big();
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
  // A title tries last frame's spot first: told it sat left, it stays left though right is free.
  const left = place([{ i: 0, x: 200, y: 150, r: 3, w: 80, h: 14, spot: 1 }], { ...at, covers: () => false });
  assert.equal(left[0]!.spot, 1);
  assert.ok(left[0]!.box[2] < 200);
});

test("hubs: the most linked, from a least, and the set holds still", async () => {
  const { hubSet } = await import("../packs/field/labels.ts");
  const ids = ["a", "b", "c", "d", "e"];
  // Two hubs from three links up: d and b; e has too few.
  assert.deepEqual([...hubSet(ids, [5, 9, 4, 12, 2], new Set(), 2, 3, 0)].sort(), ["b", "d"]);
  // a passes b by one: with no hold, b drops; held for one more rank, b stays beside the newcomer.
  const had = new Set(["b", "d"]);
  assert.deepEqual([...hubSet(ids, [10, 9, 4, 12, 2], had, 2, 3, 0)].sort(), ["a", "d"]);
  assert.deepEqual([...hubSet(ids, [10, 9, 4, 12, 2], had, 2, 3, 1)].sort(), ["a", "b", "d"]);
  // Ties go by id, so the same counts give the same set whatever the order.
  assert.deepEqual([...hubSet(["y", "x"], [4, 4], new Set(), 1, 1, 0)], ["x"]);
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

test("find keeps what it finds, the next steps in full, then a faint edge", async () => {
  const { around, FOUND, NEAR, FAINT } = await import("../packs/field/filter.ts");
  // A chain a - b - c - d - e, and f alone.
  const item = (id: string) => ({ id, title: id, type: "work", status: "", closed: false });
  const input: FieldIn = {
    items: ["a", "b", "c", "d", "e", "f"].map(item),
    links: [["a", "b"], ["b", "c"], ["c", "d"], ["d", "e"]].map(([from, to], k) => ({ id: `l${k}`, type: "depends_on", from: from!, to: to! })),
  };
  const level = around(input, new Set(["b"]), 1, 1);
  assert.deepEqual(Object.fromEntries(level), { b: FOUND, a: NEAR, c: NEAR, d: FAINT });
  assert.equal(level.has("e") || level.has("f"), false, "past the faint edge, nothing stays");
  assert.deepEqual([...around(input, new Set(["b"]), 0, 0).keys()], ["b"], "0 and 0: only what it finds");
  assert.equal(around(input, new Set(["zz"]), 1, 1).size, 0, "an id not drawn is never kept");
});

test("shapes: each has the area of its circle, and its edge is where it reaches", async () => {
  const { edge, reach, edgeSlope, CIRCLE } = await import("../packs/field/shapes.ts");
  const { SHAPES } = await import("../spec/style.ts");
  for (let s = 0; s < SHAPES.length; s++) {
    // The area under the edge, all the way round, is π (a unit circle's).
    let area = 0;
    const steps = 3600;
    for (let k = 0; k < steps; k++) area += (edge(s, (k / steps) * 2 * Math.PI) ** 2 * Math.PI) / steps;
    assert.ok(Math.abs(area - Math.PI) < 0.01, `${SHAPES[s]}: area ${area.toFixed(3)}`);
    let most = 0;
    for (let k = 0; k < steps; k++) most = Math.max(most, edge(s, (k / steps) * 2 * Math.PI));
    assert.ok(Math.abs(most - reach(s)) < 1e-3, `${SHAPES[s]} reaches ${reach(s).toFixed(3)}`);
    // The slope is edge's own.
    const th = 0.3, h = 1e-5;
    assert.ok(Math.abs((edge(s, th + h) - edge(s, th - h)) / (2 * h) - edgeSlope(s, th)) < 1e-4, `${SHAPES[s]}'s slope`);
  }
  assert.equal(edge(CIRCLE, 1.234), 1);
  // A square's flat side is nearer than its corner.
  const square = SHAPES.indexOf("square");
  assert.ok(edge(square, 0) < edge(square, Math.PI / 4));
});

test("flow: what an item waits on is ranked before it, and a plan settles left to right", async () => {
  const { ranks } = await import("../packs/field/behaviours/flow.ts");
  const item = (id: string) => ({ id, title: id, type: "work", status: "todo", closed: false });
  // d waits on c and b; c and b wait on a; x waits on itself through y (a loop).
  const dep = (from: string, to: string, k: number) => ({ id: `d${k}`, type: "depends_on", from, to });
  const input: FieldIn = {
    items: ["a", "b", "c", "d", "x", "y", "lone"].map(item),
    links: [dep("b", "a", 0), dep("c", "a", 1), dep("d", "b", 2), dep("d", "c", 3), dep("x", "y", 4), dep("y", "x", 5), { id: "p", type: "part_of", from: "lone", to: "a" }],
  };
  const g = build(input, null);
  const r = ranks(g, g.linkKinds.map((t) => t === "depends_on"));
  const rank = (id: string) => r.rank[g.idIx.get(id)!];
  assert.deepEqual(["a", "b", "c", "d"].map(rank), [0, 1, 1, 2]);
  assert.equal(rank("lone"), -1, "no order link: no rank");
  assert.ok(rank("x")! >= 0 && rank("y")! >= 0, "a loop is cut, not lost");
  const { g: laid } = settle(input);
  const x = (id: string) => laid.x[laid.idIx.get(id)!]!;
  assert.ok(x("a") < x("b") && x("a") < x("c") && x("b") < x("d") && x("c") < x("d"), "left to right in order");
});

test("link names: none over a title or each other, the lit first, upright", async () => {
  const { placeWires, arrow, wireName } = await import("../packs/field/wires.ts");
  const w = (e: number, x1: number, y1: number, x2: number, y2: number, lit = false) => ({ e, x1, y1, x2, y2, w: 50, h: 11, lit });
  const at = { width: 400, height: 300, from: 60, most: 10, ends: 10, taken: [[150, 140, 250, 160]] as [number, number, number, number][] };
  const placed = placeWires([w(0, 0, 50, 300, 50), w(1, 0, 52, 300, 52), w(2, 100, 150, 300, 150), w(3, 10, 200, 40, 200), w(4, 300, 250, 100, 250, true)], at);
  const ids = placed.map((p) => p.e);
  assert.equal(ids[0], 4, "the lit first");
  assert.ok(ids.includes(0) && !ids.includes(1), "a name over another is left out");
  assert.ok(!ids.includes(2), "none over a title");
  assert.ok(!ids.includes(3), "a link too short is not named");
  assert.ok(placed.every((p) => Math.abs(p.angle) <= Math.PI / 2), "upright");
  // An arrow's tip sits on the far end's edge, pointing at it.
  const [tx, ty] = arrow(0, 0, 100, 0, 10, 6, 4);
  assert.deepEqual([tx, ty], [90, 0]);
  assert.equal(wireName("depends_on"), "depends on");
});

test("link names grow with the zoom between a least and a most, and fade in and out instead of popping", async () => {
  const { wireSize, easeWires } = await import("../packs/field/wires.ts");
  assert.equal(wireSize(9, 1, 6, 22), 9);
  assert.equal(wireSize(9, 2, 6, 22), 18, "twice the zoom, twice the size");
  assert.equal(wireSize(9, 4, 6, 22), 22, "stops growing at the most");
  assert.equal(wireSize(9, 0.5, 6, 22), 0, "too small to read: not drawn");
  const fades = new Map();
  assert.equal(easeWires(fades, [{ e: 1, x: 5, y: 5, angle: 0 }], 0.5), true);
  assert.equal(fades.get(1).a, 0.5, "fading in");
  easeWires(fades, [{ e: 1, x: 9, y: 5, angle: 0 }], 1);
  assert.deepEqual(fades.get(1), { a: 1, x: 9, y: 5, angle: 0 }, "in, and where it is placed now");
  assert.equal(easeWires(fades, [], 0.5), true, "lost its room: fading out");
  easeWires(fades, [], 1);
  assert.equal(fades.has(1), false, "gone once faded out");
});

test("the legend's keys: each base by its shape, each status by how full it is drawn", async () => {
  const { facets } = await import("../packs/field/filter.ts");
  const { markPath } = await import("../packs/field/shapes.ts");
  // task and bug share the base work (square, 0); question is its own base (diamond, 1). Sides: 0 fresh, 1 moving, 2 done.
  const input: FieldIn = {
    items: [
      { id: "a", title: "a", type: "task", status: "todo", closed: false, base: "work", shape: 0, side: 0 },
      { id: "b", title: "b", type: "task", status: "doing", closed: false, base: "work", shape: 0, side: 1 },
      { id: "c", title: "c", type: "task", status: "done", closed: true, base: "work", shape: 0, side: 2 },
      { id: "d", title: "d", type: "bug", status: "open", closed: false, base: "work", shape: 0, side: 0 },
      { id: "e", title: "e", type: "question", status: "open", closed: false, base: "question", shape: 1, side: 0 },
    ],
    links: [],
  };
  const f = facets(input, { types: ["bug"] });
  assert.deepEqual(f.bases.map((b) => [b.name, b.shape, b.types.join("+"), b.n, b.shown]), [["work", 0, "bug+task", 4, 3], ["question", 1, "question", 1, 1]]);
  const task = f.types.find((t) => t.name === "task")!;
  assert.deepEqual([task.base, task.shape], ["work", 0]);
  // A type's statuses in the order they are drawn: hollow, half, then closed.
  assert.deepEqual(task.statuses.map((s) => [s.name, s.side]), [["todo", 0], ["doing", 1], ["done", 2]]);
  assert.deepEqual([f.fresh.n, f.fresh.shown, f.moving.n], [3, 2, 1]);
  // The mark: full is one ring, hollow two, half two with the inner cut at the middle.
  const rings = (d: string) => d.split("M").length - 1;
  assert.equal(rings(markPath(0, 2, 6, 6, 4, 0.4)), 1);
  assert.equal(rings(markPath(0, 0, 6, 6, 4, 0.4)), 2);
  const half = markPath(1, 1, 6, 6, 4, 0.4);
  assert.equal(rings(half), 2);
  const xs = half.split("M")[2]!.split(/[LZ]/).filter(Boolean).map((p) => +p.trim().split(" ")[0]!);
  assert.ok(xs.every((x) => x >= 6 - 1e-9), "half: only the right of the inner shape is cut out");
  assert.equal(rings(markPath(2, 1, 6, 6, 4, 0.4)), 2);
});

test("the legend's fill switches hide open items by how full they are drawn", async () => {
  const { shown, toggle } = await import("../packs/field/filter.ts");
  const input: FieldIn = {
    items: [
      { id: "a", title: "a", type: "task", status: "todo", closed: false, side: 0 },
      { id: "b", title: "b", type: "task", status: "doing", closed: false, side: 1 },
      { id: "c", title: "c", type: "task", status: "done", closed: true, side: 2 },
    ],
    links: [],
  };
  const ids = (h: Parameters<typeof shown>[1]) => [...shown(input, h).items].sort().join("");
  assert.equal(ids({ sides: ["fresh"] }), "bc");
  assert.equal(ids({ sides: ["moving"] }), "ac");
  assert.equal(ids({ sides: ["fresh", "moving"] }), "c");
  assert.deepEqual(toggle(toggle({}, "sides", "fresh"), "sides", "fresh"), {});
});
