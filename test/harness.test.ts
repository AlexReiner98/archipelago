/**
 * The harness view, its pure parts: rows opened in place (expand.ts), the
 * tree of places and nodes (layout.ts), a run played to a point
 * (replay.ts), and the agents round the tree with their traffic and
 * profiles (agents.ts). Input in, what each answers out.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ExchangeEvent } from "../spec/exchange.ts";
import { asText, expand, fold, pretty } from "../packs/harness/expand.ts";
import type { NodeInfo, RunInfo } from "../spec/agent.ts";
import { HUES } from "../spec/style.ts";
import { colourOf, colours, isLive, keepLast, liveRuns, LIVE_MOST } from "../packs/harness/live.ts";
import { groupsOf } from "../packs/harness/hooks.ts";
import { DECIDED, dotsBox, nameOf, anglesOf, boughsOf, branchAt, cut, leavesOf, lightOf, packHues, pointAt, radial, ROOT, route, spotOf, STYLE, treeOf } from "../packs/harness/layout.ts";
import { easeView, fitKey, HIT_PX, nearest, shouldFit } from "../packs/harness/canvas.ts";
import { crowded, quadsOverlap, type Quad } from "../packs/harness/labels.ts";
import { holdsOf, indexAt, nodeOf, playhead, stateAt, tickOf } from "../packs/harness/replay.ts";
import { placementOf, placementText } from "../packs/harness/agents.ts";
import { DIALS, dialsOf } from "../packs/harness/dials.ts";
import { focusOf, heardBy, switchFocus, transitionName, treesAndRows } from "../packs/harness/trees.ts";
import { landsLive } from "../packs/harness/hooks.ts";
import { gotAt } from "../packs/harness/got.ts";

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

test("radial: names read left to right and point away from their dot; the root's boughs are named level, over their dot", () => {
  const t = treeOf(NODES);
  const p = radial(t);
  let level = 0;
  for (const n of t.order) {
    if (!n.parent) continue;
    const l = p.labels.get(n.id)!;
    assert.ok(l.turn > -90 - 1e-6 && l.turn <= 90 + 1e-6, `${n.id} turned ${l.turn}`);
    if (n.parent === t.root && n.kids.length) {
      // Level, centred on its dot, above it: the root's boughs' names never meet at the root.
      assert.equal(l.turn, 0, n.id);
      assert.equal(l.anchor, "start");
      assert.ok(l.dx < 0 && l.dy < 0, n.id);
      level++;
      continue;
    }
    const out = n.kids.length ? -1 : 1;
    const x = p.xy.get(n.id)!.x;
    // A leaf's name runs outward: away from the middle on its side.
    const outward = (l.anchor === "start") === (x >= -1e-6);
    assert.equal(outward, out > 0, n.id);
  }
  assert.ok(level > 0, "the fixture has boughs off the root");
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
  assert.equal(h.get("loaded"), STYLE.hues[2], "hue-2 is skipped: too near the harness's orange");
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

// ---------- live.ts: every live run at once ----------

const runInfo = (run: string, ended?: string, last?: string) => ({ run, agent: { kind: "agent", id: "a" }, harness: "test", reaches: [], started: "2026-11-21T09:00:00Z", ...(ended ? { ended } : {}), ...(last ? { last } : {}) }) as unknown as RunInfo;
/** Ten minutes after the runs above began. */
const SOON = Date.parse("2026-11-21T09:10:00Z");

test("the live runs: those not ended, in the order given, more than there are hues, up to the page", () => {
  const runs = [runInfo("a"), runInfo("b", "2026-11-21T10:00:00Z"), runInfo("c"), runInfo("d")];
  assert.deepEqual(liveRuns(runs, LIVE_MOST, 30, SOON).map((r) => r.run), ["a", "c", "d"]);
  assert.deepEqual(liveRuns(runs, 2, 30, SOON).map((r) => r.run), ["a", "c"]);
  assert.equal(liveRuns(Array.from({ length: 10 }, (_, i) => runInfo(`r${i}`)), LIVE_MOST, 30, SOON).length, 10);
  assert.equal(liveRuns(Array.from({ length: 80 }, (_, i) => runInfo(`r${i}`)), LIVE_MOST, 30, SOON).length, LIVE_MOST);
});

test("a run quiet past the dial is not live: an archived or killed session leaves the previews for the list", () => {
  const hour = Date.parse("2026-11-21T10:00:00Z");
  assert.equal(isLive(runInfo("a", undefined, "2026-11-21T09:45:00Z"), 30, hour), true, "heard 15 minutes ago");
  assert.equal(isLive(runInfo("a", undefined, "2026-11-21T09:15:00Z"), 30, hour), false, "quiet 45 minutes");
  assert.equal(isLive(runInfo("a", undefined, "2026-11-21T09:15:00Z"), 60, hour), true, "the dial lets it stay");
  assert.equal(isLive(runInfo("a"), 30, hour), false, "no event since it began an hour ago");
  assert.equal(isLive(runInfo("a", "2026-11-21T09:59:00Z", "2026-11-21T09:59:00Z"), 30, hour), false, "ended");
});

test("a live run keeps its colour slot while it stays; a new one takes the lowest free, past six too", () => {
  const one = colours(["a", "b", "c"]);
  assert.deepEqual([...one], [["a", 0], ["b", 1], ["c", 2]]);
  // b ends, d begins, and a moves to the back by acting last: no one else's colour changes.
  const two = colours(["c", "d", "a"], one);
  assert.equal(two.get("a"), 0);
  assert.equal(two.get("c"), 2);
  assert.equal(two.get("d"), 1);
  assert.equal(two.has("b"), false);
  const many = colours(Array.from({ length: 9 }, (_, i) => `r${i}`));
  assert.deepEqual([...many.values()], [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("colourOf: the hues but the warm ones near Claude Code's orange, then round again mixed toward the text, then the page; tokens only", () => {
  assert.equal(colourOf(0), "var(--hue-1, CanvasText)");
  assert.equal(colourOf(1), "var(--hue-3, CanvasText)", "hue-2 is too near Claude Code's orange");
  assert.equal(colourOf(2), "var(--hue-5, CanvasText)", "and hue-4");
  assert.equal(colourOf(3), "var(--hue-6, CanvasText)");
  assert.match(colourOf(4), /^color-mix\(in srgb, var\(--hue-1, [^)]*\) \d+%, var\(--fg, [^)]*\)\)$/);
  assert.match(colourOf(9), /var\(--hue-3, .*var\(--bg, /);
  for (let i = 0; i < 40; i++) assert.ok(!/hue-[24]/.test(colourOf(i)), "never hue-2 or hue-4");
  const twenty = Array.from({ length: 24 }, (_, i) => colourOf(i));
  assert.equal(new Set(twenty).size, 24, "no two of the first 24 alike");
  for (const c of twenty) assert.ok(!/#|rgb\(/.test(c), "never a value of its own");
});

test("groupsOf: runs in the same profiles are one group, asked once; one not placed yet stands alone", () => {
  const p = (id: string) => ({ id, title: id, by: "match" as const, holding: true });
  const placements = new Map([["a", [p("x"), p("y")]], ["b", [p("y"), p("x")]], ["c", [p("z")]]]);
  const g = groupsOf([runInfo("a"), runInfo("b"), runInfo("c"), runInfo("d")], placements);
  assert.deepEqual([...g.values()].map((rs) => rs.map((r) => r.run)), [["a", "b"], ["c"], ["d"]]);
});

test("the interleaved list keeps each event once, the last few", () => {
  const e = (run: string, seq: number) => ({ ...base, id: `${run}:${seq}`, run, seq, direction: "to_agent", kind: "say" }) as ExchangeEvent;
  let list: ExchangeEvent[] = [];
  for (const x of [e("a", 1), e("b", 1), e("a", 2), e("a", 2), e("b", 2)]) list = keepLast(list, x, 3);
  assert.deepEqual(list.map((x) => x.id), ["b:1", "a:2", "b:2"]);
});

// --- The home hub: agents round the tree, their traffic, their profiles ---

test("dialsOf: given values kept within range, the rest where they start", () => {
  const d = dialsOf({ switch_s: 9999, nope: 3 });
  assert.equal(d.switch_s, DIALS.find((x) => x.key === "switch_s")!.max);
  assert.ok(!("nope" in d));
  assert.deepEqual(dialsOf(undefined), dialsOf({}));
  assert.equal(dialsOf({ switch_s: 0.2 }).switch_s, 0.2);
});

test("each agent's own tree: the nodes it hears, all while that isn't known; the one picked in focus while it is live, else the last active", () => {
  assert.deepEqual(heardBy(NODES, new Set(["words/bash", "loaded/docs"])).map((n) => n.id), ["words/bash", "loaded/docs"]);
  assert.equal(heardBy(NODES, undefined).length, NODES.length);
  assert.equal(focusOf(["r1", "r2", "r3"], "r2"), "r2");
  assert.equal(focusOf(["r1", "r2"], "gone"), "r1", "a picked run that ended gives way to the last active");
  assert.equal(focusOf(["r1"], undefined), "r1");
  assert.equal(focusOf([], "r1"), undefined);
});

test("placementOf: matched, the fallback, or none; a run that named the fallback itself is matched", () => {
  const p = (id: string, by: "match" | "part" = "match") => ({ id, title: id[0]!.toUpperCase() + id.slice(1), by, holding: true });
  const fallbacks = new Set(["arch"]);
  assert.deepEqual(placementOf([p("aperture"), p("everyone", "part")], fallbacks), { kind: "matched", title: "Aperture", ids: ["aperture", "everyone"], id: "aperture" }, "the first it matched names its tree");
  assert.equal(placementOf([p("arch"), p("everyone", "part")], fallbacks).kind, "fallback");
  assert.equal(placementOf([p("arch")], fallbacks, ["arch"]).kind, "matched");
  assert.deepEqual(placementOf([], fallbacks), { kind: "none", title: "", ids: [] });
  assert.equal(placementText(placementOf([p("arch")], fallbacks)), "○ Arch");
  assert.equal(placementText(placementOf([], fallbacks)), "– no context filter");
});

test("landsLive: nothing picked watches every live run; a run, every run or live turned off doesn't", () => {
  assert.equal(landsLive(undefined, undefined, false), true);
  assert.equal(landsLive(true, "r1", false), true);
  assert.equal(landsLive(undefined, "r1", false), false);
  assert.equal(landsLive(undefined, undefined, true), false);
  assert.equal(landsLive(false, undefined, false), false, "the last active, asked for");
  assert.equal(landsLive(undefined, undefined, false, false), false, "none live: the last active, so an ended first run is seen");
  assert.equal(landsLive(true, undefined, false, false), true, "live asked for stays live");
});

test("dotsBox: a small tree fits its dots, tighter than its bounds with names", () => {
  const placed = radial(treeOf(NODES));
  const d = dotsBox(placed, 10);
  for (const p of placed.xy.values()) assert.ok(p.x >= d.x && p.x <= d.x + d.width && p.y >= d.y && p.y <= d.y + d.height);
  assert.ok(d.width * d.height < placed.box.width * placed.box.height);
});

test("treesAndRows: a tree for the one in focus and three last active besides; a line for each of the rest", () => {
  const runs = Array.from({ length: 40 }, (_, i) => `r${i}`);
  const { trees, rows } = treesAndRows(runs, "r25");
  assert.deepEqual(trees, ["r0", "r1", "r2", "r25"]);
  assert.equal(rows.length, 36);
  assert.ok(!rows.includes("r25"));
  assert.deepEqual(treesAndRows(runs, "r1").trees, ["r0", "r1", "r2", "r3"], "focus among the last active: the next one previews");
  assert.deepEqual(treesAndRows(["a", "b"], undefined), { trees: ["a", "b"], rows: [] });
});

test("switchFocus: where the page has no view transitions, the change happens at once; names are one per colour slot", () => {
  let changed = 0;
  switchFocus(() => changed++, 0.4);
  assert.equal(changed, 1);
  assert.equal(transitionName(7), "hv-agent-7");
  assert.notEqual(transitionName(0), transitionName(1));
});


test("fitKey: the same shape read again keeps the camera; a node more or a new size fits again", () => {
  const b = { x: -100.2, y: -80.4, width: 200.4, height: 160.6 };
  assert.equal(fitKey(10, b), fitKey(10, { ...b, x: -100.4 }));
  assert.notEqual(fitKey(10, b), fitKey(11, b));
  assert.notEqual(fitKey(10, b), fitKey(10, { ...b, width: 260 }));
});

test("nameOf: a name never shows a path, but says whose it is: the project, and the file when it isn't the usual one", () => {
  assert.equal(nameOf("project memory ~/Documents/Github/archipelago-next/CLAUDE.md"), "project memory · archipelago-next");
  assert.equal(nameOf("local memory ~/Documents/Github/archipelago/CLAUDE.local.md"), "local memory · archipelago");
  assert.equal(nameOf("project memory ~/Documents/Github/Aperture/.claude/pelago.md"), "project memory · Aperture pelago.md");
  assert.equal(nameOf("auto memory ~/.claude/projects/C--Users-me-Documents-Github-archipelago-next/memory/MEMORY.md"), "auto memory · archipelago-next");
  assert.equal(nameOf("project memory ~/Documents/CLAUDE.md"), "project memory · Documents", "only plain folders: the last of them");
  assert.equal(nameOf("C:\\work\\notes\\todo.md"), "notes todo.md");
  assert.equal(nameOf("~/x/CLAUDE.md"), "x");
  assert.equal(nameOf("project memory ~/Documents/.claude/pelago.md"), "project memory · Documents pelago.md", "never Claude's own folder");
  assert.equal(nameOf("No secrets"), "No secrets");
});

test("quadsOverlap: turned outlines, not boxes; crowded: a wire name that hits anything shown, or one kept before it, fades", () => {
  const box = (x: number, y: number, w: number, h: number): Quad => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  assert.ok(quadsOverlap(box(0, 0, 10, 4), box(5, 2, 10, 4)));
  assert.ok(!quadsOverlap(box(0, 0, 10, 4), box(11, 0, 10, 4)));
  // Two thin diagonals whose boxes overlap but whose outlines don't.
  const diag = (x: number): Quad => [[x, 0], [x + 1, 0], [x + 11, 10], [x + 10, 10]];
  assert.ok(!quadsOverlap(diag(0), diag(3)));
  const names = [box(0, 0, 10, 4), box(5, 0, 10, 4), box(30, 0, 10, 4)];
  assert.deepEqual(crowded(names, [box(32, 1, 2, 2)]), [false, true, true], "the second hits the first, kept; the third hits a dot");
});

test("shouldFit: every tree fits once and then only when asked", () => {
  const at = (o: Partial<{ fitted: boolean; manual: boolean; asked: boolean; outgrown: boolean }>) => shouldFit({ fitted: false, manual: false, asked: false, ...o });
  assert.equal(at({}), true, "the first time");
  assert.equal(at({ fitted: true }), false, "the map changed: the camera stays");
  assert.equal(at({ manual: true }), false);
  assert.equal(at({ fitted: true, manual: true, asked: true }), true, "a double-click");
  assert.equal(at({ fitted: true, outgrown: true }), true, "the tree outgrew the view: fit again");
  assert.equal(at({ fitted: true, manual: true, outgrown: true }), false, "moved by hand: it stays");
});

test("outgrown: a box past any edge of the camera's view", async () => {
  const { outgrown } = await import("../packs/harness/camera.ts");
  const v = { x: 0, y: 0, k: 2 };
  assert.equal(outgrown({ x: 10, y: 10, width: 100, height: 100 }, v, 400, 400), false, "inside the 200 by 200 seen");
  assert.equal(outgrown({ x: 10, y: 10, width: 300, height: 100 }, v, 400, 400), true, "past the right");
  assert.equal(outgrown({ x: -20, y: 10, width: 50, height: 50 }, v, 400, 400), true, "past the left");
});

test("atFoot: new lines keep the list at its foot only when it is already there", async () => {
  const { atFoot } = await import("../packs/harness/events.ts");
  assert.equal(atFoot(1000, 600, 400), true);
  assert.equal(atFoot(1000, 590, 400), true, "within a little slack");
  assert.equal(atFoot(1000, 300, 400), false, "scrolled up to read: it stays put");
});

test("nearest: a press picks the nearest node within reach of its dot; none further; the reach is generous", () => {
  const pts = [{ id: "a", x: 0, y: 0 }, { id: "b", x: 30, y: 0 }];
  assert.equal(nearest(pts, { x: 10, y: 0 }, HIT_PX), "a");
  assert.equal(nearest(pts, { x: 20, y: 0 }, HIT_PX), "b");
  assert.equal(nearest(pts, { x: 0, y: 40 }, HIT_PX), undefined);
  assert.ok(HIT_PX >= 20);
});

test("channels: how a node reaches the agent, as its dot's shape; hang by channel, then who", async () => {
  const { channelOf, shapeOf, shapePath } = await import("../packs/harness/channels.ts");
  const node = (o: Partial<NodeInfo>): NodeInfo => ({ id: `words/${o.name ?? "n"}`, name: "n", pack: "words", kind: "instruction", title: "t", at: ["prompt"], ...o });
  assert.equal(channelOf(node({})), "hook");
  assert.equal(channelOf(node({ kind: "rule" })), "rule");
  assert.equal(channelOf(node({ kind: "schema_check", pack: "schema" })), "rule");
  assert.equal(channelOf(node({ kind: "memory", pack: "loaded" })), "file");
  assert.equal(channelOf(node({ at: ["skill:docs"] })), "file", "the map's words written into a skill");
  assert.equal(channelOf(node({ kind: "tool_text" })), "context");
  assert.equal(channelOf(node({ pack: "transcript", kind: "given", name: "r#system" })), "context");
  assert.equal(channelOf(node({ pack: "transcript", kind: "given", name: "r#hook:tool:Bash:guard" })), "hook");
  assert.deepEqual(["hook", "rule", "file", "context"].map((c) => shapeOf(c as never)), ["circle", "diamond", "square", "triangle"]);
  assert.match(shapePath("diamond", 4), /^M0 -5L5 0L0 5L-5 0Z$/);
  const given = (name: string) => ({ ...node({ pack: "transcript", kind: "given", name: `r#${name}`, at: ["session_start"] }), id: `transcript/r#${name}`, by: "Claude Code" }) as NodeInfo;
  const tree = treeOf([node({ name: "a" }), node({ name: "b", kind: "rule" }), node({ name: "c", kind: "rule" }), given("system"), given("model")], { by: "channel" });
  const path = (id: string) => {
    const out: string[] = [];
    for (let t = tree.byId.get(id)?.parent; t?.parent; t = t.parent) out.unshift(t.title);
    return out.join(" / ");
  };
  assert.equal(path("words/b"), "rule / words");
  assert.equal(path("transcript/r#system"), "context / Claude Code");
});

test("the key filters: a channel, the map's own, or the harness's", async () => {
  const { shows } = await import("../packs/harness/channels.ts");
  const map = { kind: "instruction", pack: "words", at: ["prompt"], name: "w" };
  const rule = { kind: "rule", pack: "words", at: ["tool:*"], name: "r" };
  const sys = { kind: "given", pack: "transcript", at: ["session_start"], name: "run#system" };
  const hook = { kind: "given", pack: "transcript", at: ["tool:Bash"], name: "run#hook:tool:Bash:guard" };
  const all = [map, rule, sys, hook];
  const left = (off: string[]) => all.filter((n) => shows(n, new Set(off))).map((n) => n.name);
  assert.deepEqual(left([]), ["w", "r", "run#system", "run#hook:tool:Bash:guard"]);
  assert.deepEqual(left(["map"]), ["run#system", "run#hook:tool:Bash:guard"]);
  assert.deepEqual(left(["harness"]), ["w", "r"]);
  assert.deepEqual(left(["context"]), ["w", "r", "run#hook:tool:Bash:guard"]);
  assert.deepEqual(left(["hook", "rule"]), ["run#system"]);
});

test("a channel's shape is bigger than a dot, and keeps a size on screen when zoomed out", async () => {
  const { shapeRadius, SHAPE_MOST } = await import("../packs/harness/key.ts");
  assert.equal(shapeRadius(2.5, 1, false), 4, "1.6 times a plain leaf");
  assert.equal(shapeRadius(5, 1, false), SHAPE_MOST, "capped short of the name");
  assert.equal(shapeRadius(2.5, 0.25, false) * 0.25, 4, "4 px on screen at a quarter zoom");
  assert.equal(shapeRadius(2.5, 1, true), 5);
});

test("the key lists only the marks the tree shows; a hidden filter stays so it can come back", async () => {
  const { marksIn } = await import("../packs/harness/key.ts");
  const node = (o: Partial<NodeInfo>): NodeInfo => ({ id: `words/${o.name ?? "n"}`, name: "n", pack: "words", kind: "instruction", title: "t", at: ["prompt"], ...o });
  const fresh = marksIn({ nodes: [node({})], heard: new Map(), held: new Map(), trial: () => false });
  assert.deepEqual([...fresh].sort(), ["hook", "map", "pack:words"], "a new user's tree: who, how, which pack; no run marks yet");
  const run = marksIn({
    nodes: [node({ name: "a", source: "i_t" }), node({ name: "b", kind: "rule" }), { ...node({ name: "r#system", pack: "transcript", kind: "given" }), id: "transcript/r#system" }],
    heard: new Map([["words/a", "said"]]),
    held: new Map([["words/b", "shadow"]]),
    rings: new Map([["words/a", "held"]]),
    trial: (n) => n.source === "i_t",
    off: new Set(["file"]),
  });
  for (const m of ["said", "acted", "shadow", "v-held", "trial", "map", "harness", "hook", "rule", "context", "file", "pack:words"]) assert.ok(run.has(m), m);
  for (const m of ["refused", "held", "v-failed", "v-quiet", "pack:transcript"]) assert.ok(!run.has(m), m);
});

test("an opened say shows the whole block the agent got at its moment, tagged and in the adapter's order", () => {
  const t = "2026-11-21T09:00:00Z";
  const ev = (seq: number, over: Partial<ExchangeEvent>): ExchangeEvent => ({ id: `e${seq}`, run: "r", seq, time: t, direction: "to_agent", kind: "say", ...over }) as ExchangeEvent;
  const events: ExchangeEvent[] = [
    ev(1, { kind: "begin", direction: "from_agent" }),
    ev(2, { place: "session_start", node: "since/heard", text: "Two changes." }),
    ev(3, { place: "session_start", node: "words/b", text: "Always b.\nAnd more." }),
    ev(4, { place: "session_start", node: "words/a", text: "Always a." }),
    ev(5, { place: "prompt", node: "words/a", text: "Later.", time: "2026-11-21T09:01:00Z" }),
    ev(6, { place: "memory:project/CLAUDE.md", node: "loaded/m", text: "Loaded.", time: "2026-11-21T09:02:00Z" }),
  ];
  const speakers = new Map([
    ["words/a", { title: "Rule a", kind: "instruction" }],
    ["words/b", { title: "Rule b", kind: "instruction" }],
    ["since/heard", { title: "Since you last heard", kind: "reflex" }],
    ["loaded/m", { title: "project memory CLAUDE.md", kind: "memory" }],
  ]);
  const block = "[Rule a] Always a.\n\n[Rule b]\nAlways b.\nAnd more.\n\n[Since you last heard] Two changes.";
  assert.equal(gotAt(events, 2, speakers), block, "the moment's says, standing first");
  assert.equal(gotAt(events, 3, speakers), block, "any say of the moment opens the same block");
  assert.equal(gotAt(events, 4, speakers), "[Rule a] Later.", "another moment is its own block");
  assert.equal(gotAt(events, 5, speakers), undefined, "a load's words aren't handed back");
  assert.equal(gotAt(events, 0, speakers), undefined, "not a say");
  assert.deepEqual(expand(events[1]!, block).map((p) => p.label), ["kind", "node", "place", "said", "agent got", "at"]);
});

test("the window bar: each share on the window's scale, a click shows only that share, a mark per node at the playhead", async () => {
  const { only, sharesOf, tok, windowMarks, windowShown } = await import("../packs/harness/windowbar.ts");
  const { marksIn } = await import("../packs/harness/key.ts");
  const w = {
    total: { tokens: 50_000, from: "usage" as const },
    limit: { tokens: 200_000, from: "default" as const },
    compactions: 1,
    sources: { map: 1_000, harness: 30_000, agent: 4_000 },
    channels: { hook: 1_500, rule: 0, file: 500, context: 29_000, talk: 0, act: 4_000 },
    unseen: 15_000,
    parts: [
      { id: "words/a", title: "A", source: "map" as const, channel: "hook" as const, state: "said" as const, tokens: 900, count: 1 },
      { id: "words/b", title: "B", source: "map" as const, channel: "hook" as const, state: "dropped" as const, tokens: 50, count: 1 },
      { id: "transcript/r#system", title: "System prompt", source: "harness" as const, channel: "context" as const, state: "start" as const, tokens: 29_000, count: 1 },
      { id: "transcript/r#skills", title: "Skill listing", source: "harness" as const, channel: "context" as const, state: "listed" as const, tokens: 400, count: 1 },
      { id: "act:tool:Bash", title: "tool:Bash", source: "agent" as const, channel: "act" as const, state: "said" as const, tokens: 4_000, count: 3 },
    ],
  };
  const { sources, channels } = sharesOf(w);
  assert.deepEqual(sources.map((s) => [s.key, s.tokens, s.filter]), [["map", 1_000, "map"], ["harness", 30_000, "harness"], ["agent", 4_000, undefined], ["unseen", 15_000, undefined]]);
  assert.deepEqual(channels.map((s) => s.key), ["hook", "file", "context", "act", "unseen"], "a channel with nothing in the window has no share");
  // A click shows only that share of its row; again, everything; the other row is left as it was.
  assert.deepEqual([...only(new Set(), "map")], ["harness"]);
  assert.deepEqual([...only(new Set(["harness"]), "map")], []);
  assert.deepEqual([...only(new Set(["harness"]), "hook")].sort(), ["context", "file", "harness", "rule", "talk"]);
  assert.deepEqual([...only(new Set(["rule", "file", "context"]), "context")].sort(), ["file", "hook", "rule", "talk"]);
  // The marks: in (said or from the start), listed, dropped; the agent's acts have no node.
  const marks = windowMarks(w);
  assert.deepEqual([...marks], [["words/a", "in"], ["words/b", "dropped"], ["transcript/r#system", "in"], ["transcript/r#skills", "listed"]]);
  assert.equal(windowMarks(undefined).size, 0);
  // The key lists a window mark only when the tree in sight shows it.
  const node = (id: string): NodeInfo => ({ id, pack: "words", name: id, kind: "instruction", title: id, at: ["session_start"] });
  const tree = treeOf([node("words/a")], {});
  const shown = windowShown(marks, tree);
  assert.deepEqual([...shown], [["words/a", "in"]]);
  const present = marksIn({ nodes: [node("words/a")], heard: new Map(), held: new Map(), trial: () => false, window: shown });
  assert.ok(present.has("w-in") && !present.has("w-dropped") && !present.has("w-listed"));
  assert.deepEqual([tok(950), tok(9_876), tok(12_345), tok(121_000), tok(1_000_000), tok(1_250_000)], ["950", "9.9k", "12k", "121k", "1M", "1.25M"]);
});

test("the conversation's nodes: the talk channel, a hexagon", async () => {
  const { channelOf, shapeOf, shapePath, CHANNELS } = await import("../packs/harness/channels.ts");
  const n = (name: string): NodeInfo => ({ id: `transcript/r#${name}`, pack: "transcript", name: `r#${name}`, kind: "given", title: name, at: ["prompt"] });
  assert.equal(channelOf(n("talk:prompt")), "talk");
  assert.equal(channelOf(n("hook:prompt:x")), "hook");
  assert.equal(shapeOf("talk"), "hexagon");
  assert.ok(CHANNELS.some((c) => c.channel === "talk"));
  assert.match(shapePath("hexagon", 4), /^M-4\.4 0L/);
});

test("how sure each number is: fitted, estimated, measured, marked in the bar", async () => {
  const { sharesOf, sure, sureOf } = await import("../packs/harness/windowbar.ts");
  assert.equal(sureOf(100, 99.5), "fitted");
  assert.equal(sureOf(100, 95), "partly");
  assert.equal(sureOf(100, 0.5), "estimated");
  assert.equal(sureOf(0, 0), "estimated");
  assert.deepEqual(sure(12_000, 12_000).text, "~12k");
  assert.equal(sure(2_000, 0).text, "≈2k");
  assert.equal(sure(10_000, 5_000).text, "~≈10k");
  assert.match(sure(10_000, 5_000).tip, /5k fitted, 5k estimated/);
  const w = {
    total: { tokens: 50_000, from: "usage" as const },
    limit: { tokens: 200_000, from: "default" as const },
    compactions: 0,
    sources: { map: 1_000, harness: 30_000, agent: 9_000 },
    channels: { hook: 1_000, rule: 0, file: 0, context: 30_000, talk: 9_000, act: 0 },
    fitted: { sources: { map: 0, harness: 30_000, agent: 9_000 }, channels: { hook: 0, rule: 0, file: 0, context: 30_000, talk: 9_000, act: 0 } },
    unseen: 10_000,
    parts: [],
  };
  const { sources } = sharesOf(w);
  assert.deepEqual(sources.map((s) => [s.key, s.fitted]), [["map", 0], ["harness", 30_000], ["agent", 9_000], ["unseen", undefined]], "what isn't counted apart is measured: no fitted share");
  assert.equal(sources[2]!.title, "the conversation");
});

test("the map's own row: each node it controls in the window, biggest first, named without a path", async () => {
  const { mapShares } = await import("../packs/harness/windowbar.ts");
  const part = (id: string, title: string, tokens: number, state: "said" | "listed" | "dropped" | "start", source: "map" | "harness" = "map") => ({ id, title, source, channel: "hook" as const, state, tokens, count: 1 });
  const w = {
    total: { tokens: 10_000, from: "usage" as const },
    limit: { tokens: 200_000, from: "default" as const },
    compactions: 1,
    sources: { map: 600, harness: 9_000, agent: 0 },
    channels: { hook: 600, rule: 0, file: 0, context: 9_000, talk: 0, act: 0 },
    unseen: 400,
    parts: [
      part("words/a", "Stay on the branch", 100, "said"),
      part("loaded/mem", "project memory C:/Users/pat/proj/CLAUDE.md", 400, "said"),
      part("loaded/docs", "docs", 3, "listed"),
      part("words/old", "Gone", 900, "dropped"),
      part("transcript/r#system", "System prompt", 9_000, "start", "harness"),
    ],
  };
  const shares = mapShares(w);
  assert.deepEqual(shares.map((s) => [s.id, s.pack, s.tokens, s.state]), [["loaded/mem", "loaded", 400, "said"], ["words/a", "words", 100, "said"], ["loaded/docs", "loaded", 3, "listed"]], "the map's alone, dropped left out");
  assert.ok(!shares[0]!.title.includes("Users"), "never a path");
  assert.ok(shares.every((s) => s.channel === "hook"), "each node with the channel it came in by, for its hue");
});

test("the window bar's hues: each channel its own, so the rows tell apart", async () => {
  const { CHANNEL_HUE } = await import("../packs/harness/windowbar.ts");
  const hues = Object.values(CHANNEL_HUE);
  assert.equal(new Set(hues).size, hues.length);
});

test("the wire names give way the same through the grid: a crowded name hides, the first of two overlapping keeps", async () => {
  const { crowded } = await import("../packs/harness/labels.ts");
  const sq = (x: number, y: number, w = 10, h = 10): [number, number][] => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  // Far apart across many cells, one on a dot, two on each other, one spanning cells.
  const names = [sq(0, 0), sq(500, 500), sq(1000, 0), sq(1005, 5), sq(60, 200, 200, 10)];
  const shown = [sq(505, 505, 2, 2), sq(250, 205, 4, 4)];
  assert.deepEqual(crowded(names, shown), [false, true, false, true, true]);
  assert.deepEqual(crowded([], shown), []);
});

test("the scene: a branch and a mark for each node, the way to the picked node, a said node larger and its count", async () => {
  const { sceneOf } = await import("../packs/harness/scene.ts");
  const tree = treeOf(NODES);
  const placed = radial(tree);
  const none = new Map();
  const scene = sceneOf({ tree, placed, hues: packHues(NODES.map((n) => n.pack)), statuses: none, heard: new Map([["words/bash", "said" as const]]), held: none, counts: new Map([["words/bash", 7]]), standing: new Map([["words/bash", "up" as const]]), picked: "words/bash", window: new Map([["words/bash", "in" as const]]), theirs: new Set() });
  assert.equal(scene.wires.length, tree.order.length - 1);
  assert.equal(scene.marks.length, tree.order.length - 1);
  const bash = scene.marks.find((m) => m.node === "words/bash")!;
  const plain = scene.marks.find((m) => m.node === "words/spec")!;
  assert.ok(bash.r > plain.r, "said seven times: larger");
  assert.deepEqual([bash.hear, bash.said, bash.standing, bash.picked, bash.window, bash.shape], ["said", 7, "up", true, "in", "circle"]);
  assert.match(bash.tip, /said 7 times\nin the window now$/);
  const way = scene.wires.filter((w) => w.way).map((w) => w.id);
  assert.deepEqual(way, ["~:tool", "~:tool:Bash", "words/bash"].filter((id) => tree.byId.has(id)));
  assert.ok(scene.marks.filter((m) => m.bough).every((m) => !m.node && m.r === STYLE.node));
});

test("a dot's ink: a trial is hollow in its hue, a given never used is faint, a pick is outlined, a light on its way holds back the said", async () => {
  const { dotInk, INK } = await import("../packs/harness/scene.ts");
  const m = { id: "x", node: "x", x: 0, y: 0, depth: 2, bough: false, r: 2.5, shape: "circle" as const, trial: false, theirs: false, given: false, unused: false, retired: false, picked: false, label: { text: "x", turn: 0, dx: 8, dy: 0, anchor: "start" as const }, tip: "" };
  assert.deepEqual(dotInk({ ...m, hue: "red" }, false), { fill: "red", fillAlpha: 0.85, strokeWidth: 1 });
  assert.deepEqual(dotInk({ ...m, hue: "red", trial: true }, false), { fillAlpha: 0.85, stroke: "red", strokeWidth: 1.2 });
  assert.deepEqual(dotInk({ ...m, given: true, theirs: true, unused: true, hue: "red" }, false), { fill: INK.harness, fillAlpha: 0.15, stroke: INK.harness, strokeWidth: 1.2 });
  assert.deepEqual(dotInk({ ...m, picked: true }, false), { fill: INK.fg, fillAlpha: 0.85, stroke: INK.pick, strokeWidth: 2 });
  assert.equal(dotInk({ ...m, hear: "said" }, false).fillAlpha, 1);
  assert.equal(dotInk({ ...m, hear: "said" }, true).fillAlpha, 0.85, "the light is on its way");
  assert.deepEqual(dotInk({ ...m, hold: "shadow" }, false).dash, [1.5, 1]);
  assert.equal(dotInk({ ...m, bough: true, node: undefined, shape: undefined }, false).fillAlpha, 0.5);
});

test("a name's ink: said in blue, refused in red until the light arrives; lit in the run's colour; small names only what is lit, said or picked", async () => {
  const { nameInk, nameRuns, INK } = await import("../packs/harness/scene.ts");
  const m = { id: "x", node: "x", x: 0, y: 0, depth: 2, bough: false, r: 2.5, trial: false, theirs: false, given: false, unused: false, retired: false, picked: false, label: { text: "x", turn: 0, dx: 8, dy: 0, anchor: "start" as const }, tip: "" };
  const big = { waiting: false, small: false };
  assert.deepEqual(nameInk(m, big), { color: INK.fg, weight: "bold", alpha: 1, italic: false, struck: false });
  assert.equal(nameInk({ ...m, hear: "said" }, big).color, INK.say);
  assert.equal(nameInk({ ...m, hear: "refused" }, { ...big, waiting: true }).color, INK.fg, "not before the light gets there");
  assert.equal(nameInk(m, { ...big, lit: { tone: "say", color: "green" } }).color, "green");
  assert.equal(nameInk(m, { ...big, lit: { tone: "fail", color: "green" } }).color, INK.fail);
  assert.deepEqual(nameInk({ ...m, bough: true, theirs: true }, { ...big, small: true }), { color: INK.harness, weight: "500", alpha: 0.8, italic: false, struck: false });
  assert.equal(nameInk(m, { ...big, small: true }).alpha, 0);
  assert.equal(nameInk({ ...m, picked: true }, { ...big, small: true }).alpha, 1);
  assert.deepEqual([nameInk({ ...m, trial: true }, big).italic, nameInk({ ...m, hold: "held" }, big).struck, nameInk({ ...m, retired: true }, big).color], [true, true, INK.dim]);
  // On the left half a name reads toward its dot: its standing and count come first.
  assert.deepEqual(nameRuns({ ...m, said: 3, standing: "up" }).map((r) => r.text), ["x", " 3", " ↑"]);
  assert.deepEqual(nameRuns({ ...m, said: 3, standing: "up", label: { ...m.label, anchor: "end" } }).map((r) => r.text), ["↑ ", "3 ", "x"]);
});

test("the wire names give way by their turned outlines: a deeper name over a nearer one hides, one clear of all stays", async () => {
  const { crowdedNames, nameQuad, boxQuad } = await import("../packs/harness/labels.ts");
  const at = (x: number, y: number, turn = 0) => nameQuad({ x, y, turn, from: 0, to: 40, dy: 0, h: 12 }, 1);
  const names = [
    { id: "deep", depth: 3, quad: at(10, 4) },
    { id: "near", depth: 1, quad: at(0, 0) },
    { id: "clear", depth: 2, quad: at(200, 200) },
    { id: "on-dot", depth: 1, quad: at(400, 0, 90) },
  ];
  assert.deepEqual([...crowdedNames(names, [boxQuad(398, 20, 402, 24, 1)])].sort(), ["deep", "on-dot"]);
  // Twice the zoom: twice the outline, in screen pixels.
  assert.deepEqual(nameQuad({ x: 1, y: 0, turn: 0, from: 0, to: 2, dy: 0, h: 2 }, 2), [[2, -2], [6, -2], [6, 2], [2, 2]]);
});

test("a time is written once per input, and nothing for none", async () => {
  const { day, time } = await import("../packs/harness/clock.ts");
  const t = "2026-11-21T09:05:07Z";
  assert.equal(day(t), new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }));
  assert.equal(time(t), new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  assert.equal(day(t), day(t));
  assert.equal(day(undefined), "");
  assert.equal(time("not a time"), "");
});

test("seen whole, a node's name shows only if it matters: below quiet_px on screen it fades out over two px", async () => {
  const { quietShown } = await import("../packs/harness/paint.ts");
  assert.equal(quietShown(5, 0), 1, "0: every name");
  assert.equal(quietShown(9, 9), 1, "whole from the dial's size");
  assert.equal(quietShown(8, 9), 0.5, "half a step below");
  assert.equal(quietShown(7, 9), 0, "gone two px below");
  assert.equal(dialsOf({}).quiet_px, 0, "the dial starts at 0: every name");
  assert.equal(dialsOf({}).name_most, 28, "names cut at 28 characters");
  assert.equal(radial(treeOf([{ id: "words/a", title: "A name far longer than twenty-eight characters", at: ["prompt"], pack: "words", kind: "reflex" } as never]), { nameMost: 28 }).labels.get("words/a")?.text.length, 28, "cut with an ellipsis");
});

test("while zooming, names come from an atlas: a zoom stepped to a few sizes per doubling, pictures placed shelf by shelf", async () => {
  const { textZoom } = await import("../packs/harness/paint.ts");
  const { Shelves } = await import("../packs/harness/sprites.ts");
  assert.equal(textZoom(1.3, 0), 1.3, "no steps: the zoom itself");
  assert.equal(textZoom(1, 4), 1);
  assert.equal(textZoom(1.15, 4), 2 ** 0.25, "the nearest quarter of a doubling");
  assert.equal(textZoom(1.05, 4), 1);
  const s = new Shelves(100);
  assert.deepEqual(s.take(60, 10), { x: 0, y: 0, w: 60, h: 10 });
  assert.deepEqual(s.take(30, 20), { x: 61, y: 0, w: 30, h: 20 });
  assert.deepEqual(s.take(50, 10), { x: 0, y: 21, w: 50, h: 10 }, "a new shelf under the tallest");
  assert.equal(s.take(101, 1), undefined, "too wide for the atlas: drawn as text");
  assert.equal(s.take(10, 90), undefined, "full");
  s.reset();
  assert.deepEqual(s.take(10, 90), { x: 0, y: 0, w: 10, h: 90 });
});

test("easeView: a fit glides from where the camera is to where it fits, eased, the zoom in proportion", () => {
  const a = { x: 0, y: 0, k: 1 }, b = { x: 100, y: 50, k: 4 };
  assert.deepEqual(easeView(a, b, 0, 800, 600), a);
  const end = easeView(a, b, 1, 800, 600);
  assert.ok(Math.abs(end.x - 100) < 1e-9 && Math.abs(end.y - 50) < 1e-9 && Math.abs(end.k - 4) < 1e-9);
  assert.ok(Math.abs(easeView(a, b, 0.5, 800, 600).k - 2) < 1e-9, "halfway, the zoom is halfway by its logarithm");
  const c = (v: { x: number; y: number; k: number }) => v.x + 400 / v.k;
  assert.ok(Math.abs(c(easeView(a, b, 0.5, 800, 600)) - (c(a) + c(b)) / 2) < 1e-9, "the centre goes in a straight line");
  assert.ok(easeView(a, b, 0.1, 800, 600).k - 1 < (4 - 1) * 0.1, "it starts slowly");
});

test("harness: the key's turned-off marks are read back from what the browser stored, and nothing else", async () => {
  const { offOf } = await import("../packs/harness/keyoff.ts");
  assert.deepEqual([...offOf('["harness","words"]')], ["harness", "words"]);
  assert.deepEqual([...offOf(null)], []);
  assert.deepEqual([...offOf("not json")], []);
  assert.deepEqual([...offOf('{"harness":true}')], []);
  assert.deepEqual([...offOf('["harness", 3]')], ["harness"]);
});

test("harness: a fit lands at once first and while the tree finds its size (fit_settle_ms); later fits glide", async () => {
  const { snapsFit } = await import("../packs/harness/camera.ts");
  assert.equal(snapsFit(true, 0, 800, 600), true, "the first");
  assert.equal(snapsFit(false, 300, 800, 600), true, "settling: a view that just appeared is not seen to zoom into place");
  assert.equal(snapsFit(false, 900, 800, 600), false, "after: it glides");
  assert.equal(snapsFit(false, 900, 800, 0), true, "fit_ms 0: always at once");
});

test("placeLabel: an MCP tool's place reads as its server and name; any other place as it is", async () => {
  const { placeLabel } = await import("../packs/harness/events.ts");
  assert.equal(placeLabel("tool:mcp__archipelago__query"), "tool:archipelago.query");
  assert.equal(placeLabel("tool:mcp__my_server__do_it"), "tool:my_server.do_it");
  assert.equal(placeLabel("tool:Edit"), "tool:Edit");
  assert.equal(placeLabel("file:index.html"), "file:index.html");
});

test("openFilter: a context filter's view, live on its session when one is live, else its own tree", async () => {
  const { openFilter, VIEW } = await import("../packs/harness/open.ts");
  const live = new Map(openFilter("f1", ["r1", "r2"]));
  assert.equal(live.get("harness.live"), true);
  assert.equal(live.get("harness.focus"), "r1");
  assert.equal(live.get("harness.profile"), undefined);
  assert.equal(live.get("here.view"), VIEW);
  const none = new Map(openFilter("f1", []));
  assert.equal(none.get("harness.profile"), "f1");
  assert.equal(none.get("harness.live"), undefined);
  assert.equal(none.get("here.view"), VIEW);
});

test("heardYet: an agent's tree waits for what it hears and where it is placed, never every node first", async () => {
  const { heardYet } = await import("../packs/harness/agents.ts");
  const placement = { kind: "matched" as const, title: "F", ids: ["f"], id: "f" };
  assert.equal(heardYet({}), false);
  assert.equal(heardYet({ hears: new Set(["a"]) }), false, "placed not yet known");
  assert.equal(heardYet({ placement }), false, "what it hears not yet known");
  assert.equal(heardYet({ hears: new Set(), placement }), true);
});

test("markSvgPath: a filter's mark as a path beside the view's title, a hexagon six corners", async () => {
  const { markSvgPath } = await import("../packs/harness/paint.ts");
  assert.equal(markSvgPath("hexagon").split("L").length, 6);
  assert.equal(markSvgPath("triangle").split("L").length, 3);
  assert.ok(markSvgPath("circle").includes("A"), "a circle is arcs");
});

test("glide: a changed tree moves into its new shape, a new node growing out of its parent, the end exactly the new layout", async () => {
  const { radial, treeOf } = await import("../packs/harness/layout.ts");
  const { glide } = await import("../packs/harness/glide.ts");
  const before = treeOf([node("words", "a", ["tool:Bash"]), node("words", "b", ["prompt"])]);
  const after = treeOf([node("words", "a", ["tool:Bash"]), node("words", "b", ["prompt"]), node("words", "c", ["tool:Edit"])]);
  const from = radial(before), to = radial(after);
  assert.equal(glide(after, from, to, 1), to, "at the end, the new layout itself");
  const start = glide(after, from, to, 0);
  // At the start, what was there is where it was.
  assert.deepEqual(start.polar.get("words/a"), from.polar.get("words/a"));
  // A new node starts where its nearest old ancestor was, and every node has a branch to draw.
  const c = after.byId.get("words/c")!;
  let up = c.parent;
  while (up && !from.polar.has(up.id)) up = up.parent;
  assert.deepEqual(start.polar.get("words/c"), from.polar.get(up!.id));
  for (const t of after.order) if (t.parent) assert.ok(start.branch.has(t.id) && start.along.has(t.id), t.id);
  // Half way, a moved node is between its two places.
  const mid = glide(after, from, to, 0.5).polar.get("words/a")!, a0 = from.polar.get("words/a")!, a1 = to.polar.get("words/a")!;
  assert.ok(Math.abs(mid.r - (a0.r + a1.r) / 2) < 1e-6);
});
