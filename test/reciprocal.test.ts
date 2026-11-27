/**
 * The reciprocal frame, off the page: a seeded mesh in, the rules run as a
 * DAG, the agents settled by the field's step, and every contact touching
 * on the normal's side out.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { RUN, defaults } from "../plugins/field/step.ts";
import { AGENTS, ENGAGE, SWEEP, restAt } from "../plugins/reciprocal/agents.ts";
import { endAt, fans, rests, type RG } from "../plugins/reciprocal/beams.ts";
import { mesh } from "../plugins/reciprocal/mesh.ts";
import { INPUT, RUN_HERE } from "../plugins/reciprocal/dials.ts";
import { RULES, diameterKey, measure, solveStep } from "../plugins/reciprocal/pipeline.ts";
import { evaluate, order } from "../plugins/reciprocal/rules.ts";

const S0 = (): Record<string, number> => ({ ...defaults([...INPUT, ENGAGE, SWEEP, ...AGENTS.flatMap((b) => b.dials({ links: [] })), ...RUN.map((d) => ({ ...d, value: RUN_HERE[d.key] ?? d.value }))]) });

const settle = (g: RG, S: Record<string, number>, most = 8000) => {
  let k = 0;
  while (k < most && solveStep(g, S) > 0) k++;
  return k;
};

test("the rules are a DAG, mesh first and measure last", () => {
  const { names, depth } = order(RULES);
  assert.equal(names[0], "mesh");
  assert.equal(names.at(-1), "measure");
  assert.ok(depth.solve! > depth.frame!);
  assert.throws(() => order([{ name: "a", doc: "", needs: ["b"], dials: [] }, { name: "b", doc: "", needs: ["a"], dials: [] }]), /cycle/);
});

test("a fan of five is one cycle, closed at one contact; the rest is a DAG from the supports up", () => {
  const m = mesh("fan", 2);
  const f = fans(m);
  assert.deepEqual(f[0]!.length, 5);
  const r = rests(m, f, 0);
  assert.equal(r.contacts.length, 5);
  assert.equal(r.contacts.filter((c) => c.closing).length, 1);
  // Every contact the DAG keeps goes from a lower level to a higher one.
  for (const c of r.contacts) if (!c.closing) assert.ok(r.level[c.over]! > r.level[c.under]!);
  assert.equal(new Set(r.order).size, 5);
});

test("every seeded mesh settles with each end touching the beam it rests on, on the normal's side", () => {
  for (const name of [0, 1, 2]) {
    const S = { ...S0(), mesh: name };
    const g = evaluate(RULES, S).out.frame as RG;
    const steps = settle(g, S);
    const mz = measure(g);
    assert.ok(g.sim.settled, `mesh ${name} settled (${steps} steps, push ${g.sim.push})`);
    assert.ok(mz.most < 0.05, `mesh ${name}: worst gap ${(mz.most * 100).toFixed(1)}% of the diameter`);
    assert.equal(mz.under, 0, `mesh ${name}: no end under the beam it rests on`);
  }
});

test("a beam's own diameter runs radii only, and the solve moves its contacts to match", () => {
  const S = S0();
  const first = evaluate(RULES, S);
  const g = first.out.frame as RG;
  settle(g, S);
  const b = g.rf.rests.contacts.find((c) => !g.fixed[2 * c.over])!.over;
  const S2 = { ...S, [diameterKey(b)]: 30 };
  const next = evaluate(RULES, S2, first);
  assert.deepEqual(Object.entries(next.ran).filter(([, r]) => r.ran).map(([n]) => n).sort(), ["measure", "radii", "solve"]);
  assert.equal(next.out.frame, g);
  g.rf.r = next.out.radii as Float32Array;
  g.sim.alpha = 0.5;
  g.sim.from = g.sim.steps;
  settle(g, S2);
  const mz = measure(g);
  assert.ok(mz.most < 0.05, `worst gap ${(mz.most * 100).toFixed(1)}%`);
  const c = g.rf.rests.contacts.findIndex((x) => x.over === b);
  assert.ok(Math.abs(mz.gap[c]!) < 1, "the thick beam's contact touches");
});

test("collide, hold and length push down their energy's slope; rest and the sweep aim at the same point", () => {
  const S = S0();
  const g = evaluate(RULES, S).out.frame as RG;
  for (let k = 0; k < 30; k++) solveStep(g, S);
  S.on_hold = S.on_length = 1;
  // Nudge so collide and length have something to push.
  for (let i = 0; i < g.n; i++) if (!g.fixed[i]) (g.x[i]! += Math.sin(i) * 3), (g.z[i]! += Math.cos(i) * 3);
  const f = { x: new Float32Array(g.n), y: new Float32Array(g.n), z: new Float32Array(g.n) };
  for (const b of AGENTS.filter((x) => x.name !== "rest")) {
    f.x.fill(0), f.y.fill(0), f.z.fill(0);
    b.apply(g, f, S, g.sim);
    for (const i of [1, 7, 13, 21]) {
      const h = 1e-2, x0 = g.x[i]!;
      g.x[i] = x0 + h;
      const up = b.energy(g, S);
      g.x[i] = x0 - h;
      const down = b.energy(g, S);
      g.x[i] = x0;
      const slope = -(up - down) / (2 * h);
      assert.ok(Math.abs(slope - f.x[i]!) < 0.05 * Math.max(1, Math.abs(slope)), `${b.name} at ${i}: push ${f.x[i]} against slope ${slope}`);
    }
  }
  // Where the sweep puts a resting end, rest pushes it no more.
  const c = g.rf.rests.contacts.find((x) => !x.closing && !g.fixed[endAt(g.rf.mesh, x.over, x.node)])!;
  const i = endAt(g.rf.mesh, c.over, c.node);
  for (let k = 0; k < 20; k++) {
    const to = restAt(g, c.node, c.over, c.under, S);
    (g.x[i] = to[0]), (g.y[i] = to[1]), (g.z[i] = to[2]);
  }
  const to = restAt(g, c.node, c.over, c.under, S);
  assert.ok(Math.hypot(g.x[i]! - to[0], g.y[i]! - to[1], g.z[i]! - to[2]) < 1e-3);
});

test("the DAG's sweep settles faster than the pushes alone", () => {
  const run = (sweep: number) => {
    const S = { ...S0(), sweep };
    const g = evaluate(RULES, S).out.frame as RG;
    return [settle(g, S), measure(g).most] as const;
  };
  const [withSweep, gapWith] = run(0.5), [without, gapWithout] = run(0);
  assert.ok(withSweep < without, `${withSweep} steps swept, ${without} not`);
  assert.ok(gapWith <= gapWithout);
});
