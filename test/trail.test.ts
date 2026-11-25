import { test } from "node:test";
import assert from "node:assert/strict";
import { idsIn, latest, toolTitle, trailOf } from "../plugins/trail/index.ts";
import { TRAIL_TYPES, withTrail } from "../plugins/field/trail.ts";
import type { FieldIn } from "../plugins/field/graph.ts";
import type { RunInfo } from "../spec/agent.ts";
import type { ExchangeEvent, ExchangeRead } from "../spec/exchange.ts";

const info = { run: "r1", title: "Plan the launch", cwd: "/home/me/launch" } as unknown as RunInfo;
let seq = 0;
const ev = (e: Partial<ExchangeEvent>): ExchangeEvent => ({ id: `e${++seq}`, run: "r1", seq, time: "2026-11-25T10:00:00Z", direction: "from_agent", kind: "act", ...e }) as ExchangeEvent;
const prompt = () => ev({ place: "prompt", act: { kind: "prompt", by: "person", input: "make a plan for pat@example.org" } });
const tool = (name: string, input: unknown, output: unknown, ok = true) => ev({ place: `tool:${name}`, act: { kind: "tool", by: "agent", input: input as never, output: output as never, ok } });
const say = (node: string, kind = "say") => ev({ kind, direction: "to_agent", node, place: "prompt", text: "the words the map said" });

const events = () => {
  seq = 0;
  return [
    ev({ kind: "begin", direction: "to_agent" }),
    say("since"),
    prompt(),
    say("i_mx1aaaaaaa"),
    say("i_mx1aaaaaaa"),
    tool("mcp__archipelago__act", { action: "items.create", input: { type: "task", title: "Launch" } }, '{"ids":["i_mx1bbbbbbb"]}'),
    tool("mcp__archipelago__act", { action: "items.set", input: { id: "i_mx1ccccccc", status: "done" } }, { refused: "schema" }, false),
    ev({ place: "reply_end", act: { kind: "reply", by: "agent", output: "Done: the plan is on the map." } }),
    prompt(),
    tool("Bash", { command: "ls /home/me" }, "a b c"),
    say("words/l_mx1ddddddd", "refuse"),
    ev({ place: "tool:Bash", act: { kind: "decision", by: "person", output: "deny", ok: false } }),
  ];
};

test("trailOf: a turn at each prompt, its tool calls with the ids they name, the nodes said once each with a count", () => {
  const t = trailOf(info, events());
  assert.equal(t.run, "r1");
  assert.equal(t.title, "Plan the launch");
  assert.deepEqual(t.turns.map((x) => x.title), ["start", "turn 1", "turn 2"]);
  assert.deepEqual(t.turns[0]!.says, [{ node: "since", kind: "say", count: 1 }]);
  const one = t.turns[1]!;
  assert.deepEqual(one.says, [{ node: "i_mx1aaaaaaa", kind: "say", count: 2 }]);
  assert.deepEqual(one.acts.map((a) => [a.title, a.ok, a.ids]), [
    ["act items.create", true, ["i_mx1bbbbbbb"]],
    ["act items.set", false, ["i_mx1ccccccc"]],
  ]);
  const two = t.turns[2]!;
  // A person's decision on a tool call is an approval, drawn as an act, never a decision about the work.
  assert.deepEqual(two.acts.map((a) => [a.title, a.kind, a.ok]), [["Bash", "tool", true], ["denied Bash", "decision", false]]);
  assert.deepEqual(two.says, [{ node: "words/l_mx1ddddddd", kind: "refuse", count: 1 }]);
});

test("trailOf: no text of what was said or done is kept", () => {
  const kept = JSON.stringify(trailOf(info, events()));
  for (const text of ["the words the map said", "pat@example.org", "Done: the plan", "/home/me", "a b c"]) assert.ok(!kept.includes(text), text);
});

test("trailOf: events before the ones drawn hang from an earlier turn", () => {
  const t = trailOf(info, events().slice(3), 3);
  assert.equal(t.earlier, 3);
  assert.equal(t.turns[0]!.title, "earlier");
});

test("idsIn and toolTitle", () => {
  assert.deepEqual(idsIn({ a: "c_mwwc7i1zpayv", b: ["r_mwwc7udvuzft", "c_mwwc7i1zpayv"], c: "not_an id" }), ["c_mwwc7i1zpayv", "r_mwwc7udvuzft"]);
  assert.deepEqual(idsIn(null), []);
  assert.equal(idsIn(Array.from({ length: 50 }, (_, k) => `i_aaaaaaa${k.toString(36).padStart(2, "0")}`)).length, 20);
  assert.equal(toolTitle("tool:mcp__archipelago__query", { find: "x" }), "query");
  assert.equal(toolTitle("tool:mcp__archipelago__act", { action: "items.link" }), "act items.link");
  assert.equal(toolTitle("tool:Edit", {}), "Edit");
  assert.equal(toolTitle("tool:mcp__docs__read_page", {}), "docs read_page");
});

test("latest: the run's latest events, read a page at a time, and how many came before them", async () => {
  const all = Array.from({ length: 1200 }, (_, k) => ({ seq: k + 1 }) as ExchangeEvent);
  const asked: number[] = [];
  const read = {
    async events(_run: string, page: { limit?: number; after?: string } = {}) {
      const from = Number(page.after ?? 0), limit = page.limit ?? 100;
      asked.push(limit);
      const items = all.slice(from, from + limit);
      return { items, ...(from + limit < all.length ? { next: String(from + limit) } : {}) };
    },
  } as unknown as ExchangeRead;
  const got = await latest(read, "r1", 400);
  assert.equal(got.events.length, 400);
  assert.equal(got.events[0]!.seq, 801);
  assert.equal(got.earlier, 800);
  assert.ok(asked.every((n) => n <= 500), "every page within LIMIT_MAX");
  const short = await latest(read, "r1", 400, 1);
  assert.equal(short.events.at(-1)!.seq, 500, "no more pages than asked");
});

const map: FieldIn = {
  items: [
    { id: "i_mx1aaaaaaa", title: "Launch rules", type: "node", status: "", closed: false },
    { id: "i_mx1bbbbbbb", title: "Launch", type: "task", status: "open", closed: false },
    { id: "i_mx1eeeeeeee", title: "Pricing", type: "record", status: "", closed: false },
  ],
  links: [{ id: "l_mx1ddddddd", type: "in_context_filter", from: "i_mx1eeeeeeee", to: "f1" }],
} as unknown as FieldIn;

test("withTrail: the run hangs from its session, turns in order, calls linked to the items they touched, nodes to what they are about", () => {
  const out = withTrail(map, trailOf(info, events()), true, "#999");
  const added = out.items.slice(map.items.length);
  assert.equal(added[0]!.id, "session:r1", "a run not live gets its session drawn");
  assert.ok(added.every((it) => it.id === "session:r1" || Object.values(TRAIL_TYPES).includes(it.type as never)));
  assert.ok(added.every((it) => it.side === 0), "drawn hollow");
  const rel = (type: string) => out.links.filter((l) => l.type === type).map((l) => [l.from, l.to]);
  assert.deepEqual(rel("next").map(([, to]) => to), ["trail:r1:turn:1", "trail:r1:turn:3", "trail:r1:turn:9"]);
  // Only ids on the map are linked: the refused set named an item that is not there.
  assert.deepEqual(rel("touched"), [["trail:r1:6", "i_mx1bbbbbbb"]]);
  // A node item by its id; a node said through a context filter link, that link's item.
  assert.deepEqual(rel("about").map(([, to]) => to), ["i_mx1aaaaaaa", "i_mx1eeeeeeee"]);
  assert.ok(added.some((it) => it.title === "said Launch rules ×2"));
  assert.equal(out.colours?.[TRAIL_TYPES.call], "#999");
  // The map's own items and links are as they were, and none of them points into the trail.
  assert.equal(map.items.length, 3);
  assert.equal(map.links.length, 1);
  assert.ok(!out.links.slice(map.links.length).some((l) => map.items.some((it) => it.id === l.from)));
});

test("withTrail: off, or no trail, the map as it was; a live session is not drawn twice", () => {
  const t = trailOf(info, events());
  assert.equal(withTrail(map, t, false), map);
  assert.equal(withTrail(map, null, true), map);
  const live = { ...map, items: [...map.items, { id: "session:r1", title: "x", type: "session", status: "live", closed: false }] } as FieldIn;
  assert.equal(withTrail(live, t, true).items.filter((it) => it.id === "session:r1").length, 1);
});
