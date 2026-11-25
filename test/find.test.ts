import assert from "node:assert/strict";
import { test } from "node:test";
import type { Id } from "../spec/common.ts";
import type { HereRead, HereSet } from "../spec/here.ts";
import type { FillDef, SlotFill } from "../spec/slot.ts";
import type { TypeInfo } from "../spec/types.ts";
import { COMMON } from "../spec/types.ts";
import { Runtime, type Plugin } from "../runtime/core.ts";
import { Loader } from "../runtime/loader.ts";
import here from "../plugins/here/index.ts";
import find, { DRAWS, QUERY, type FindLine } from "../plugins/find/index.ts";
import { complete, jumpQuery, offered, suggest, type Offer, type Suggestion } from "../plugins/find/suggest.ts";
import { commandList } from "../plugins/find/line.ts";
import type { Row, Wire } from "../plugins/find/query.ts";

const base = (name: string, open: string[], closed: string[]): TypeInfo => ({ name, base: name, statuses: { open, closed }, fields: COMMON, trial: false, plugin: name });
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

/** The find plugin in a runtime, with the graph and slots as stubs. */
/** What the stub graph holds beyond ITEMS (read by get), and the watcher find set, to hand it a change. */
const WHOLE = new Map<string, { id: string; type: string; fields: Record<string, unknown> }>();
let watcher: ((c: { facts: [string, string, string, unknown][] }) => void) | undefined;

async function boot() {
  const g = globalThis as Record<string, unknown>;
  g.document ??= { createElement: () => ({ remove() {} }), head: { append() {} } };
  const fills: FillDef<unknown>[] = [];
  const all = { types: [...TYPES.values()], links: [{ name: "part_of", plugin: "x" }, { name: "depends_on", plugin: "x" }] };
  const host: Plugin = {
    id: "host",
    apply(ctx) {
      const of = async (type: string) => ({
        items: [
          ...ITEMS.filter((i) => i[1] === type).map(([id, , title, status]) => ({ id, type, fields: { title, status } })),
          ...LINKS.map(([t, from, to], i) => ({ id: `l${i}`, type: t, fields: { from, to } })).filter((l) => l.type === type),
        ],
      });
      ctx.provide("graph.read", () => ({ of, now: async () => "0", get: async (ids: string[]) => ids.map((id) => WHOLE.get(id) ?? null) }) as any);
      ctx.provide("graph.watch", () => ({ watch: (_f: unknown, on: typeof watcher) => ((watcher = on), () => {}) }));
      ctx.provide("types.read", () => ({ all: () => all, get: () => undefined, watch: () => () => {} }));
      ctx.provide("types.mark", () => ({ marks: () => ({ work: "square" }), mark: () => () => {}, watch: () => () => {} }));
      ctx.provide<SlotFill>("slot.fill", () => ({ fill: (def) => (fills.push(def as FillDef<unknown>), () => {}) }));
    },
  };
  const rt = new Runtime();
  rt.onError = (_f, e) => {
    throw e;
  };
  const modules: Record<string, Plugin> = { host, here, find };
  const loader = new Loader(rt, { base: "mem:/", import: async (url) => ({ default: modules[url.slice(5)]! }) });
  await loader.apply(["host", "here", "find"].map((id) => ({ id, plugin: id })));
  for (let i = 0; i < 20 && !rt.root.get<FindLine | undefined>("find.line"); i++) await new Promise((r) => setTimeout(r, 5));
  return { index: rt.root.get<{ item(id: string): { fields: Record<string, unknown> } | undefined }>("find.index"), line: rt.root.get<FindLine>("find.line"), read: rt.root.get<HereRead>("here.read"), set: rt.root.get<HereSet>("here.set"), fills };
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

test("the command line puts what plugins offer (views) between the terms and the items, filtered by the words", () => {
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

test("an item find didn't hold, given a type it shows, is read whole: a moved node keeps its title", async () => {
  const { index } = await boot();
  WHOLE.set("n1", { id: "n1", type: "work", fields: { title: "Moved rule", status: "todo", note: "Its words" } });
  watcher!({ facts: [["-", "n1", "type", "node"], ["+", "n1", "type", "work"], ["+", "n1", "status", "todo"]] });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(index.item("n1")?.fields.title, "Moved rule");
});

test("near: and in: take an item's title as well as its id (underscores for spaces, any case)", async () => {
  const { itemRef, run } = await import("../plugins/find/query.ts");
  const items = new Map([
    ["i_f", { id: "i_f", type: "context_filter", fields: { title: "Frontend" } }],
    ["i_r", { id: "i_r", type: "record", fields: { title: "Semantic HTML" } }],
    ["i_x", { id: "i_x", type: "record", fields: { title: "Elsewhere" } }],
  ]);
  const links = new Map([["l1", { id: "l1", type: "in_context_filter", from: "i_r", to: "i_f", fields: { at: ["file:*.html"] } }]]);
  const index = { items, links, type: () => undefined, linksOf: () => [], marks: () => ({}), closed: () => false } as never;
  assert.equal(itemRef(index, "i_f"), "i_f");
  assert.equal(itemRef(index, "frontend"), "i_f");
  assert.equal(itemRef(index, "Semantic_HTML"), "i_r");
  assert.equal(itemRef(index, "nothing"), "nothing", "unknown stays as given: it finds nothing");
  assert.deepEqual(run(index, "near:Frontend").items.map((r) => r.id).sort(), ["i_f", "i_r"]);
});
