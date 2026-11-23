import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../spec/common.ts";
import type { HereRead, HereSet } from "../spec/here.ts";
import type { FillDef, SlotFill } from "../spec/slot.ts";
import type { TypeInfo } from "../spec/types.ts";
import { COMMON } from "../spec/types.ts";
import { Runtime, type Pack } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import here from "../packs/here/index.ts";
import find, { DRAWS, QUERY, type FindLine } from "../packs/find/index.ts";
import { complete, jumpQuery, offered, suggest, type Offer, type Suggestion } from "../packs/find/suggest.ts";
import { commandList } from "../packs/find/line.ts";
import type { Row, Wire } from "../packs/find/query.ts";

const base = (name: string, open: string[], closed: string[]): TypeInfo => ({ name, base: name, statuses: { open, closed }, fields: COMMON, trial: false, pack: name });
const TYPES = new Map([
  ["work", base("work", ["todo", "doing"], ["done", "dropped"])],
  ["question", base("question", ["open"], ["decided", "dropped"])],
  ["bug", { ...base("work", ["todo", "doing"], ["done", "dropped"]), name: "bug" }],
]);
const ITEMS: [string, string, string, string][] = [
  ["hub", "work", "Track 3", "doing"],
  ["a", "work", "Base types", "done"],
  ["b", "work", "Map UI", "doing"],
  ["c", "bug", "Canvas fit is off", "todo"],
  ["q", "question", "Where is the map's edge?", "decided"],
];
const LINKS: [string, string, string][] = [
  ["part_of", "a", "hub"],
  ["part_of", "b", "hub"],
  ["depends_on", "b", "q"],
];
const IX = {
  items: new Map<string, Row>(ITEMS.map(([id, type, title, status]) => [id, { id, type, fields: { title, status } }])),
  links: new Map<string, Wire>(LINKS.map(([type, from, to], i) => [`l${i}`, { id: `l${i}`, type, from, to, fields: {} }])),
  type: (n: string) => TYPES.get(n),
};
const terms = (line: string) => suggest(IX, line).filter((s) => s.kind === "term").map((s) => (s as { term: string }).term);
const items = (line: string) => suggest(IX, line).filter((s) => s.kind === "item").map((s) => (s as { id: Id }).id);

test("find suggests terms by kind for the word being typed", () => {
  assert.deepEqual(terms("ty"), ["type:"], "a key");
  assert.deepEqual(terms("is:open d"), ["status:decided", "status:doing", "status:done", "status:dropped"], "a status");
  assert.deepEqual(terms("is:c"), ["is:closed"], "a side");
  assert.deepEqual(terms("type:"), ["type:bug", "type:question", "type:work"], "a type, flavours and bases");
  assert.deepEqual(terms("status:do"), ["status:doing", "status:done"]);
  assert.deepEqual(terms("in:track"), ["in:hub"], "an item by its title, as in:");
  const s = suggest(IX, "near:map").find((x) => x.kind === "term") as Extract<Suggestion, { kind: "term" }>;
  assert.equal(s.of, "item");
  assert.equal(s.hint, "Map UI", "shown by its title");
  assert.deepEqual(terms("q"), ["type:question"]);
  assert.deepEqual(terms("open "), [], "nothing for a finished word");
});

test("find suggests items whose titles hold every word, a title that starts with it first, open before closed", () => {
  assert.deepEqual(items("map"), ["b", "q"]);
  assert.deepEqual(items("map edge"), ["q"]);
  assert.deepEqual(items("is:open"), [], "terms alone suggest no item");
  assert.deepEqual(items("zzz"), []);
  const limited = suggest(IX, "a", 2).filter((s) => s.kind === "item");
  assert.equal(limited.length, 2);
});

test("find completes the word being typed, and a key waits for its value", () => {
  assert.equal(complete("is:open ty", "type:"), "is:open type:");
  assert.equal(complete("is:open type:w", "type:work"), "is:open type:work ");
  assert.equal(complete("map ", "is:open"), "map is:open ");
  const t = suggest(IX, "is:c")[0] as Extract<Suggestion, { kind: "term" }>;
  assert.equal(t.line, "is:closed ");
});

test("a jump keeps the query when it draws the item, else shows the item among its neighbours", () => {
  assert.equal(jumpQuery(IX, "", "b"), "", "open items are drawn by the empty query");
  assert.equal(jumpQuery(IX, "", "a"), "near:a", "a closed item is not");
  assert.equal(jumpQuery(IX, "in:hub", "a"), "in:hub");
  assert.equal(jumpQuery(IX, "canvas", "q"), "near:q");
});

/** The find pack in a runtime, with the graph and slots as stubs. */
async function boot() {
  const g = globalThis as Record<string, unknown>;
  g.document ??= { createElement: () => ({ remove() {} }), head: { append() {} } };
  const fills: FillDef<unknown>[] = [];
  const all = { types: [...TYPES.values()], links: [{ name: "part_of", pack: "x" }, { name: "depends_on", pack: "x" }] };
  const host: Pack = {
    id: "host",
    apply(ctx) {
      const of = async (type: string) => ({
        items: [
          ...ITEMS.filter((i) => i[1] === type).map(([id, , title, status]) => ({ id, type, fields: { title, status } })),
          ...LINKS.map(([t, from, to], i) => ({ id: `l${i}`, type: t, fields: { from, to } })).filter((l) => l.type === type),
        ],
      });
      ctx.provide("graph.read", () => ({ of, now: async () => "0" }) as any);
      ctx.provide("graph.watch", () => ({ watch: () => () => {} }));
      ctx.provide("types.read", () => ({ all: () => all, get: () => undefined, watch: () => () => {} }));
      ctx.provide("types.mark", () => ({ marks: () => ({ work: "square" }), mark: () => () => {}, watch: () => () => {} }));
      ctx.provide<SlotFill>("slot.fill", () => ({ fill: (def) => (fills.push(def as FillDef<unknown>), () => {}) }));
    },
  };
  const rt = new Runtime();
  rt.onError = (_f, e) => {
    throw e;
  };
  const modules: Record<string, Pack> = { host, here, find };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply(["host", "here", "find"].map((id) => ({ id, pack: id })));
  for (let i = 0; i < 20 && !rt.root.get<FindLine | undefined>("find.line"); i++) await new Promise((r) => setTimeout(r, 5));
  return { line: rt.root.get<FindLine>("find.line"), read: rt.root.get<HereRead>("here.read"), set: rt.root.get<HereSet>("here.set"), fills };
}

test("find.line jumps: the item is looked at, shown in the view, and the line sits in top where the query is drawn", async () => {
  const { line, read, set, fills } = await boot();
  assert.deepEqual(
    fills.map((f) => [f.slot, f.name, (f.when as Record<string, unknown>)["here.view"]]),
    [
      ["top", "find", "map/map"],
      ["top", "find-field", "field/field"],
    ],
  );
  assert.equal(DRAWS[0], "field/field", "a jump opens Field, home");
  set.set("here.view", "harness/run");
  line.jump("b");
  assert.equal(read.get("here.item"), "b");
  assert.equal(read.get(QUERY), undefined, "the empty query draws it: kept");
  assert.equal(read.get("here.view"), "field/field", "from a view that does not draw the query, to Field");

  set.set("here.view", "map/map");
  line.jump("a");
  assert.equal(read.get("here.item"), "a");
  assert.equal(read.get(QUERY), "near:a", "a closed item, among its neighbours");
  assert.equal(read.get("here.view"), "map/map", "Map, where it's on, draws the query too: it stays");
});

test("the command line puts what packs offer (views) between the terms and the items, filtered by the words", () => {
  const ran: string[] = [];
  const views: Offer = {
    of: "view",
    list: (words, limit) =>
      ["Map", "Field", "Roadmap"]
        .filter((t) => words.every((w) => t.toLowerCase().includes(w)))
        .slice(0, limit)
        .map((t) => ({ key: `view:${t}`, title: t, run: () => ran.push(t) })),
  };
  const rows = offered([views], "map");
  assert.deepEqual(rows.map((r) => (r.kind === "offer" ? r.title : "")), ["Map", "Roadmap"]);
  const term: Suggestion = { kind: "term", of: "key", term: "type:", line: "type:" };
  const item: Suggestion = { kind: "item", id: "i1", title: "Map the map", type: "work", status: "todo" };
  assert.deepEqual(commandList([term, item], rows).map((s) => s.kind), ["term", "offer", "offer", "item"]);
  assert.deepEqual(commandList([term], rows).map((s) => s.kind), ["term", "offer", "offer"]);
  const first = rows[0]!;
  if (first.kind === "offer") first.run();
  assert.deepEqual(ran, ["Map"]);
});
