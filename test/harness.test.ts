/**
 * The harness view, its pure parts: rows opened in place (expand.ts), the
 * tree of places and nodes (layout.ts) and a run played to a point
 * (replay.ts). Input in, what each answers out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExchangeEvent } from "../spec/exchange.ts";
import { asText, expand, fold, pretty } from "../packs/harness/expand.ts";
import type { NodeInfo } from "../spec/agent.ts";
import { DECIDED, anglesOf, boughsOf, branchAt, cut, leavesOf, lightOf, packHues, pointAt, radial, ROOT, route, spotOf, STYLE, treeOf } from "../packs/harness/layout.ts";
import { holdsOf, indexAt, nodeOf, playhead, stateAt, tickOf } from "../packs/harness/replay.ts";

const base = { id: "e1", run: "r", seq: 3, time: "2026-11-21T09:00:00Z" };
const labels = (e: ExchangeEvent) => expand(e).map((p) => p.label);

test("a say: its node, place, pack and the words whole", () => {
  const words = "One line per row.\nA row never wraps.";
  const parts = expand({ ...base, direction: "to_agent", kind: "say", node: "words/one-line", place: "file:packs/x.ts", pack: "words", text: words });
  assert.deepEqual(parts.map((p) => p.label), ["kind", "node", "place", "pack", "said", "at"]);
  assert.equal(parts.find((p) => p.label === "said")!.text, words);
});

test("a refusal is labelled refused", () => {
  assert.ok(labels({ ...base, direction: "to_agent", kind: "refuse", node: "n", place: "tool:Bash", text: "No secrets" }).includes("refused"));
});

test("a tool call by the agent: its input field by field, its MCP output as text", () => {
  const parts = expand({
    ...base,
    direction: "from_agent",
    kind: "act",
    place: "tool:mcp__archipelago__tell",
    act: { kind: "tool", by: "agent", ok: true, input: { said: "Activity built", about: ["i_1"] }, output: { content: [{ type: "text", text: '{"id":"i_2"}' }] } },
  });
  const by = new Map(parts.map((p) => [p.label, p.text]));
  assert.equal(by.get("act"), "tool by agent");
  assert.equal(by.get("input.said"), "Activity built");
  assert.equal(by.get("input.about"), '[\n  "i_1"\n]');
  assert.equal(by.get("output"), '{\n  "id": "i_2"\n}');
});

test("an output kept as JSON text is indented", () => {
  const parts = expand({ ...base, direction: "from_agent", kind: "act", place: "tool:x", act: { kind: "tool", by: "agent", output: '{"change":"c1"}' } });
  assert.equal(parts.find((p) => p.label === "output")!.text, '{\n  "change": "c1"\n}');
});

test("a failed act says so; a prompt and a reply are their text", () => {
  assert.equal(expand({ ...base, direction: "from_agent", kind: "act", place: "tool:Edit", act: { kind: "tool", by: "agent", ok: false, input: {} } })[0]!.text, "tool by agent · did not work");
  const prompt = expand({ ...base, direction: "from_agent", kind: "act", place: "prompt", act: { kind: "prompt", by: "person", input: "Build it\nwith tests" } });
  assert.deepEqual(prompt.find((p) => p.label === "prompt"), { label: "prompt", text: "Build it\nwith tests" });
  const reply = expand({ ...base, direction: "from_agent", kind: "act", place: "reply_end", act: { kind: "reply", by: "agent", output: "Done." } });
  assert.equal(reply.find((p) => p.label === "reply")!.text, "Done.");
});

test("detail is shown field by field; empty values are left out", () => {
  const parts = expand({ ...base, direction: "to_agent", kind: "gated", node: "n", text: "held back", detail: { gate: "profile", trial: true, note: "" } });
  const ls = parts.map((p) => p.label);
  assert.ok(ls.includes("detail.gate") && ls.includes("detail.trial"));
  assert.ok(!ls.includes("detail.note"));
});

test("fold: a dozen lines show, the rest is counted", () => {
  const text = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const f = fold(text);
  assert.equal(f.head.split("\n").length, 12);
  assert.equal(f.more, 8);
  assert.deepEqual(fold("short"), { head: "short", more: 0 });
  const long = fold("x".repeat(2000));
  assert.ok(long.head.endsWith("…") && long.more === 1);
});

test("pretty: JSON text indented, other text as it is", () => {
  assert.equal(pretty('{"a":[1]}'), '{\n  "a": [\n    1\n  ]\n}');
  assert.equal(pretty("{not json"), "{not json");
  assert.equal(pretty("plain words"), "plain words");
});

test("asText: strings as they are, values as indented JSON", () => {
  assert.equal(asText("a\nb"), "a\nb");
  assert.equal(asText({ a: 1 }), '{\n  "a": 1\n}');
  assert.equal(asText(undefined), "");
});

// ---------- the tree (layout.ts) ----------

const node = (pack: string, name: string, at: string[], kind = "reflex", title = name): NodeInfo => ({ id: `${pack}/${name}`, pack, name, kind, title, at });

const NODES: NodeInfo[] = [
  node("words", "start", ["session_start"], "instruction", "Says the run is recorded"),
  node("words", "spec", ["file:spec/**"], "reflex", "The spec is the owner's"),
  node("words", "packs", ["file:packs/map/*.ts"]),
  node("words", "change1", ["tool:mcp__pelago__change"]),
  node("words", "change2", ["tool:mcp__pelago__change"]),
  node("words", "report", ["tool:mcp__pelago__report"]),
  node("words", "bash", ["tool:Bash", "file:**"]),
  node("loaded", "mem", ["memory:project/~/x/CLAUDE.md"], "memory"),
  node("loaded", "docs", ["skill:anthropic-skills:docs"], "skill"),
  node("grow", "ask", ["reply_end"]),
  node("words", "kept", [], "instruction"),
];

test("boughsOf: a place's boughs, the general first", () => {
  assert.deepEqual(boughsOf("session_start"), [{ key: "session_start", title: "session start" }]);
  assert.deepEqual(boughsOf("tool:Bash").map((b) => b.title), ["tool", "Bash"]);
  assert.deepEqual(boughsOf("tool:mcp__pelago__change").map((b) => b.key), ["tool", "tool:mcp__pelago", "tool:mcp__pelago__change"]);
  assert.deepEqual(boughsOf("tool:mcp__pelago__change").map((b) => b.title), ["tool", "pelago", "change"]);
  // A file glob: its plain top folders, up to the file depth; never the globbed part.
  assert.deepEqual(boughsOf("file:packs/map/x/*.ts").map((b) => b.key), ["file", "file:packs/", "file:packs/map/"]);
  assert.deepEqual(boughsOf("file:spec/**").map((b) => b.key), ["file", "file:spec/"]);
  assert.deepEqual(boughsOf("file:**").map((b) => b.key), ["file"]);
  assert.deepEqual(boughsOf("file:packs/map/x/y.ts", 1).map((b) => b.key), ["file", "file:packs/"]);
  // A memory's path is not a bough: only its scope.
  assert.deepEqual(boughsOf("memory:project/~/x/CLAUDE.md").map((b) => b.key), ["memory", "memory:project"]);
  assert.deepEqual(boughsOf("skill:anthropic-skills:docs").map((b) => b.title), ["skill", "anthropic-skills", "docs"]);
  assert.equal(boughsOf("tool:mcp__pelago__change", 2, 2).length, 2);
  assert.deepEqual(boughsOf(undefined), []);
});

test("treeOf: every said node once, under its first place", () => {
  const t = treeOf(NODES);
  assert.equal(t.root.id, ROOT);
  const leaves = t.order.filter((n) => n.node);
  assert.equal(leaves.length, NODES.length - 1);
  assert.equal(t.hidden, 1);
  assert.equal(t.byId.get("words/change1")!.parent!.id, "~:tool:mcp__pelago__change");
  assert.equal(t.byId.get("words/change1")!.depth, 4);
  // A bough with one kid below the first level is folded into it.
  assert.equal(t.byId.get("words/bash")!.parent!.id, "~:tool");
  assert.equal(t.byId.get("~:tool:Bash"), undefined);
  assert.equal(t.byId.get("words/packs")!.parent!.id, "~:file");
  assert.equal(t.byId.get("words/packs")!.depth, 2);
  assert.equal(t.byId.get("loaded/docs")!.parent!.id, "~:skill");
  assert.equal(t.byId.get("words/report")!.parent!.id, "~:tool:mcp__pelago");
  assert.equal(t.byId.get("~:session_start")!.kids.length, 1);
  assert.equal(t.byId.get("words/start")!.parent!.id, "~:session_start");
  // Every node's depth is one more than its parent's, and the order puts parents first.
  const seen = new Set<string>();
  for (const n of t.order) {
    if (n.parent) {
      assert.equal(n.depth, n.parent.depth + 1);
      assert.ok(seen.has(n.parent.id));
    }
    seen.add(n.id);
  }
});

test("treeOf: never-said nodes on request, and by pack", () => {
  const t = treeOf(NODES, { unsaid: true });
  assert.equal(t.hidden, 0);
  assert.equal(t.byId.get("words/kept")!.parent!.id, "~:never");
  const p = treeOf(NODES, { by: "pack" });
  assert.equal(p.hidden, 0);
  assert.deepEqual(p.root.kids.map((k) => k.title), ["grow", "loaded", "words"]);
  assert.equal(p.byId.get("loaded/mem")!.parent!.id, "~:pack:loaded");
  assert.equal(p.byId.get("words/start")!.parent!.id, "~:pack:words:instruction");
});

test("treeOf: the same nodes in any order make the same tree", () => {
  const a = treeOf(NODES).order.map((n) => n.id);
  const b = treeOf([...NODES].reverse()).order.map((n) => n.id);
  assert.deepEqual(a, b);
});

test("spotOf: an act lands on the deepest bough of its place", () => {
  const t = treeOf(NODES);
  assert.equal(spotOf(t, "tool:mcp__pelago__change").id, "~:tool:mcp__pelago__change");
  assert.equal(spotOf(t, "tool:mcp__pelago__report").id, "~:tool:mcp__pelago");
  assert.equal(spotOf(t, "tool:mcp__pelago__ask").id, "~:tool:mcp__pelago");
  assert.equal(spotOf(t, "tool:Read").id, "~:tool");
  assert.equal(spotOf(t, "prompt").id, ROOT);
  assert.equal(spotOf(t, undefined).id, ROOT);
});

test("anglesOf: each subtree's share of the circle is by its leaves", () => {
  const t = treeOf(NODES);
  const leaves = leavesOf(t);
  const angles = anglesOf(t);
  assert.equal(leaves.get(ROOT), 10);
  let sum = 0;
  for (const k of t.root.kids) sum += angles.get(k.id)!.span;
  assert.ok(Math.abs(sum - Math.PI * 2) < 1e-9);
  const tool = angles.get("~:tool")!;
  assert.ok(Math.abs(tool.span - (Math.PI * 2 * leaves.get("~:tool")!) / 10) < 1e-9);
  // A kid stands inside its parent's share.
  for (const n of t.order) if (n.parent && n.parent !== t.root) {
    const p = angles.get(n.parent.id)!, c = angles.get(n.id)!;
    assert.ok(c.a >= p.a - p.span / 2 - 1e-9 && c.a <= p.a + p.span / 2 + 1e-9);
  }
});

test("radial: a ring a level, the root in the middle, branches from parent to kid", () => {
  const t = treeOf(NODES);
  const p = radial(t);
  assert.deepEqual(p.xy.get(ROOT), { x: 0, y: 0 });
  for (const n of t.order) {
    assert.equal(p.polar.get(n.id)!.r, p.ring * n.depth);
    if (!n.parent) continue;
    const pts = p.along.get(n.id)!;
    const from = p.xy.get(n.parent.id)!, to = p.xy.get(n.id)!;
    assert.ok(Math.hypot(pts[0]![0] - from.x, pts[0]![1] - from.y) < 1e-6);
    assert.ok(Math.hypot(pts.at(-1)![0] - to.x, pts.at(-1)![1] - to.y) < 1e-6);
    assert.match(p.branch.get(n.id)!, /^M[-\d. ]+ C[-\d. ]+$/);
  }
  // Every node and its name inside the box.
  for (const q of p.xy.values()) assert.ok(q.x > p.box.x && q.x < p.box.x + p.box.width && q.y > p.box.y && q.y < p.box.y + p.box.height);
});

test("radial: the ring grows until leaves' names clear each other", () => {
  const many = Array.from({ length: 200 }, (_, i) => node("words", `n${String(i).padStart(3, "0")}`, ["session_start"]));
  const t = treeOf(many);
  const p = radial(t);
  assert.ok(p.ring > STYLE.ring);
  const leaves = t.order.filter((n) => n.node).map((n) => p.polar.get(n.id)!);
  for (let i = 1; i < leaves.length; i++) {
    const a = leaves[i - 1]!, b = leaves[i]!;
    // Arc between neighbours at the leaves' radius, the narrower (vertical) way.
    assert.ok((b.a - a.a) * a.r >= STYLE.nameText - 1e-6);
  }
  // Capped, so a huge tree stays drawable.
  const huge = treeOf(Array.from({ length: 5000 }, (_, i) => node("words", `h${i}`, ["session_start"])));
  assert.equal(radial(huge).ring, STYLE.ringMost);
});

test("radial: names read left to right and point away from their dot", () => {
  const t = treeOf(NODES);
  const p = radial(t);
  for (const n of t.order) {
    if (!n.parent) continue;
    const l = p.labels.get(n.id)!;
    assert.ok(l.turn > -90 - 1e-6 && l.turn <= 90 + 1e-6, `${n.id} turned ${l.turn}`);
    const out = n.kids.length ? -1 : 1;
    const x = p.xy.get(n.id)!.x;
    // A leaf's name runs outward: away from the middle on its side.
    const outward = (l.anchor === "start") === (x >= -1e-6);
    assert.equal(outward, out > 0, n.id);
  }
});

test("route: from the root through each bough to the node", () => {
  const t = treeOf(NODES);
  const p = radial(t);
  const r = route(t, p, "words/change1");
  assert.deepEqual(r[0], [0, 0]);
  const end = p.xy.get("words/change1")!;
  assert.ok(Math.hypot(r.at(-1)![0] - end.x, r.at(-1)![1] - end.y) < 1e-6);
  assert.equal(r.length, 4 * STYLE.curveSteps + 1);
  assert.deepEqual(route(t, p, "nope"), []);
  assert.deepEqual(pointAt(r, 0), r[0]);
  const last = pointAt(r, 1);
  assert.ok(Math.hypot(last[0] - end.x, last[1] - end.y) < 1e-6);
  const mid = pointAt(r, 0.5);
  assert.ok(Math.hypot(mid[0], mid[1]) > 0 && Math.hypot(mid[0], mid[1]) < Math.hypot(end.x, end.y));
  assert.deepEqual(pointAt([], 0.5), [0, 0]);
});

test("packHues, branchAt and cut", () => {
  const h = packHues(["words", "loaded", "grow", "harness", "loaded"]);
  assert.equal(h.get("words"), STYLE.colors.owner);
  assert.equal(h.get("grow"), STYLE.colors.learned);
  assert.equal(h.get("harness"), STYLE.hues[0]);
  assert.equal(h.get("loaded"), STYLE.hues[1]);
  assert.equal(branchAt(1).width, STYLE.branch);
  assert.ok(branchAt(3).width < branchAt(2).width);
  assert.equal(branchAt(40).width, STYLE.branchLeast);
  assert.equal(branchAt(40).ink, STYLE.branchFaint);
  assert.equal(cut("abcdef", 4), "abc…");
  assert.equal(cut("abc", 4), "abc");
});

test("lightOf: a say lights its node, a refusal in red, an act sparks on its place", () => {
  const t = treeOf(NODES);
  assert.deepEqual(lightOf(t, { kind: "say", node: "words/change1", place: "tool:mcp__pelago__change" }), { kind: "light", at: "words/change1", tone: "say" });
  assert.deepEqual(lightOf(t, { kind: "refuse", node: "words/bash", place: "tool:Bash" }), { kind: "light", at: "words/bash", tone: "fail" });
  // A node not in the tree (left out, or gone): its place sparks instead.
  assert.deepEqual(lightOf(t, { kind: "say", node: "words/kept", place: "tool:Bash" }), { kind: "spark", at: "~:tool", tone: "say" });
  assert.deepEqual(lightOf(t, { kind: "act", place: "tool:mcp__pelago__report", act: { kind: "tool", by: "agent", ok: true } }), { kind: "spark", at: "~:tool:mcp__pelago", tone: "write" });
  assert.deepEqual(lightOf(t, { kind: "act", place: "tool:Edit", act: { kind: "tool", by: "agent", ok: false } }), { kind: "spark", at: "~:tool", tone: "fail" });
  assert.equal(lightOf(t, { kind: "begin" })!.at, ROOT);
  assert.equal(lightOf(t, { kind: "unknown" }), undefined);
});

test("treeOf: by profile, each node under the nearest profile it comes from", () => {
  const profiles = new Map([
    ["words/start", ["Everyone"]],
    ["words/packs", ["Archipelago", "Everyone"]],
  ]);
  const t = treeOf(NODES.filter((n) => profiles.has(n.id)), { by: "profile", profiles });
  assert.deepEqual(t.root.kids.map((k) => k.title).sort(), ["Archipelago", "Everyone"]);
  const up = (id: string) => {
    const ids: string[] = [];
    for (let n = t.byId.get(id)!.parent; n; n = n.parent) ids.push(n.id);
    return ids;
  };
  assert.ok(up("words/packs").includes("~:profile:Archipelago"));
  assert.ok(up("words/start").includes("~:profile:Everyone"));
});

test("treeOf: kept and retired nodes hang from one decided bough", () => {
  const tree = treeOf(NODES, { decided: [{ node: "words/gone", title: "Gone", up: false }, { node: "words/spec", title: "The spec is the owner's", up: true }] });
  const bough = tree.byId.get(DECIDED)!;
  assert.equal(bough.parent, tree.root);
  assert.deepEqual(bough.kids.map((k) => [k.title, k.decided]), [
    ["Gone", { node: "words/gone", up: false }],
    ["The spec is the owner's", { node: "words/spec", up: true }],
  ]);
  // A kept node is still in its place too.
  assert.ok(tree.byId.get("words/spec")?.node);
  assert.equal(treeOf(NODES).byId.has(DECIDED), false);
});

// ---------- a run played to a point (replay.ts) ----------

const ev = (seq: number, kind: string, more: Partial<ExchangeEvent> = {}): ExchangeEvent => ({ id: `e${seq}`, run: "r", seq, time: "2026-11-21T09:00:00Z", direction: kind === "act" ? "from_agent" : "to_agent", kind, ...more });
const RUN: ExchangeEvent[] = [
  ev(1, "begin"),
  ev(2, "say", { node: "words/a", place: "session_start" }),
  ev(3, "gated", { node: "words/b", place: "tool:Bash" }),
  ev(4, "gated", { node: "words/c", place: "tool:Bash", detail: { trial: true } }),
  ev(5, "act", { place: "tool:Bash", act: { kind: "tool", by: "agent", ok: false } }),
  ev(6, "refuse", { node: "words/a", place: "tool:Edit" }),
  ev(7, "say", { node: "words/a", place: "tool:Edit" }),
];

test("playhead: the event named, else the last; -1 with none", () => {
  assert.equal(playhead(RUN, "e3"), 2);
  assert.equal(playhead(RUN), 6);
  assert.equal(playhead(RUN, "gone"), 6);
  assert.equal(playhead([], undefined), -1);
});

test("stateAt: what was heard and held back by then; a refusal wins over a say", () => {
  const early = stateAt(RUN, 2);
  assert.deepEqual([...early.heard], [["words/a", "said"]]);
  assert.deepEqual([...early.held], [["words/b", "held"]]);
  assert.equal(early.at?.seq, 3);
  assert.equal(early.end, false);
  const all = stateAt(RUN, 6);
  assert.deepEqual([...all.heard], [["words/a", "refused"]]);
  assert.deepEqual([...all.held], [["words/b", "held"], ["words/c", "shadow"]]);
  assert.equal(all.end, true);
  // Counts are the run's own says, up to the playhead.
  assert.deepEqual([...early.counts], [["words/a", 1]]);
  assert.deepEqual([...all.counts], [["words/a", 2]]);
  assert.equal(stateAt([], -1).at, undefined);
});

test("tickOf: each event's mark on the timeline", () => {
  assert.deepEqual(RUN.map(tickOf), ["run", "say", "gated", "gated", "fail", "refuse", "say"]);
  assert.equal(tickOf(ev(8, "act", { act: { kind: "tool", by: "agent", ok: true } })), "act");
});

test("holdsOf: a profile's answers as holds; what it lets through is left out", () => {
  const holds = holdsOf(new Map([
    ["a", { hears: true }],
    ["b", { hears: false, why: "For CAD" }],
    ["c", { hears: true, shadow: "For CAD" }],
  ] as const));
  assert.deepEqual([...holds], [["b", "held"], ["c", "shadow"]]);
});

test("indexAt: a click on the strip lands on one of n equal ticks", () => {
  assert.equal(indexAt(0, 10), 0);
  assert.equal(indexAt(0.55, 10), 5);
  assert.equal(indexAt(1.2, 10), 9);
  assert.equal(indexAt(-1, 10), 0);
  assert.equal(indexAt(0.5, 0), -1);
});

test("nodeOf: an event's own node; an act's failed node, else the one told just before it", () => {
  assert.equal(nodeOf(RUN, 1), "words/a");
  // #5, an act: the map's lines above it (two holds, then a say) are its moment; the say is its node.
  assert.equal(nodeOf(RUN, 4), "words/a");
  // An act right after another act was told nothing.
  assert.equal(nodeOf([ev(1, "say", { node: "words/a" }), ev(2, "act", { act: { kind: "tool", by: "agent" } }), ev(3, "act", { act: { kind: "tool", by: "agent" } })], 2), undefined);
  assert.equal(nodeOf(RUN, 4, [{ node: "words/b", failed_by: [5] }]), "words/b");
  const told = [ev(1, "say", { node: "words/x", place: "tool:Edit" }), ev(2, "say", { node: "words/y", place: "file:a.ts" }), ev(3, "act", { place: "tool:Edit", act: { kind: "tool", by: "agent" } })];
  assert.equal(nodeOf(told, 2), "words/y");
  assert.equal(nodeOf([ev(1, "begin")], 0), undefined);
  assert.equal(nodeOf(RUN, 99), undefined);
});
