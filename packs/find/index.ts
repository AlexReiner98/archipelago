/**
 * The find pack, page side: the map as the page holds it, the query, and
 * the line that sets it.
 *
 * - Provides `find.index`: every item and link of a type defined now, read
 *   in bounded pages through graph.read and kept live by graph.watch; the
 *   types from types.read; and `run(query)` (query.ts). The canvas and the
 *   item page read the map through it.
 * - Declares `find.query` (page scope): the query the canvas draws. The
 *   line it puts in `top` sets it; so can anything else, an agent
 *   included. As you type, the line suggests terms and items (suggest.ts).
 * - Provides `find.line`: the line, for the command line to draw, and
 *   `jump(id)`: looks at an item and shows it in the view.
 *
 * It never writes: changes go through actions.
 */
import type { Committed } from "../../spec/changeset.ts";
import type { Dispose, Id, Json } from "../../spec/common.ts";
import type { GraphRead, GraphWatch, Item } from "../../spec/graph.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { SlotFill } from "../../spec/slot.ts";
import type { LinkInfo, TypeInfo, TypesRead } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { KEYS } from "../../spec/here.ts";
import { closed, run, type Index, type Result, type Row, type Wire } from "./query.ts";
import { jumpQuery } from "./suggest.ts";
import { makeLine, STYLE, type LineProps } from "./line.ts";

export { parse, run, closed } from "./query.ts";
export type { Result, Row, Wire } from "./query.ts";
export { suggest, jumpQuery, complete, type Suggestion } from "./suggest.ts";
export type { LineProps } from "./line.ts";

export const QUERY = "find.query";
/** The views that draw the query, as `here.view` names them: a jump from elsewhere opens the first. */
export const DRAWS = ["map/map", "field/field"];

/** `find.index`: the map as this page holds it. */
export interface FindIndex {
  /** Whether the first read is done. */
  ready(): boolean;
  item(id: Id): Row | undefined;
  /** Links at an item, both ways. */
  linksOf(id: Id): Wire[];
  types(): TypeInfo[];
  links(): LinkInfo[];
  type(name: string): TypeInfo | undefined;
  /** Whether an item's status is on its base's closed side. */
  closed(row: Row): boolean;
  run(query: string, limit?: number): Result;
  /** Calls `on` after every change to the index (or the types). */
  watch(on: () => void): Dispose;
}

/** `find.line`: the line, to draw anywhere, and the jump it makes. */
export interface FindLine {
  /** The find line; `command` is the Ctrl+K form (see line.ts). */
  Line: (props: LineProps) => unknown;
  /** Looks at an item (`here.item`) and shows it in the view: the query becomes `near:<id>` unless it draws it already. */
  jump(id: Id): void;
}

const find: Pack = {
  id: "find",
  about: "The search line: finds items by words, kind, status and links.",
  inject: ["graph.read", "graph.watch", "types.read", "here.declare", "here.read", "here.set", "slot.fill"],
  async apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    const live = ctx.get<GraphWatch>("graph.watch");
    const typesRead = ctx.get<TypesRead>("types.read");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    ctx.get<HereDeclare>("here.declare").declare({ key: QUERY, scope: "page", doc: "The query the map draws." });

    const items = new Map<Id, Row>();
    const links = new Map<Id, Wire>();
    let byType = new Map<string, TypeInfo>();
    let linkTypes: LinkInfo[] = [];
    let ready = false;
    const watchers = new Set<() => void>();
    const changed = () => {
      for (const on of [...watchers]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };
    const index: Index = { items, links, type: (n) => byType.get(n) };

    const put = (it: Item) => {
      const f = it.fields as Record<string, Json>;
      if (typeof f.from === "string" && typeof f.to === "string") links.set(it.id, { id: it.id, type: it.type, fields: f, from: f.from, to: f.to });
      else items.set(it.id, { id: it.id, type: it.type, fields: f });
    };
    /** Applies a committed set's facts to the copy, item by item. */
    const apply = (c: Committed) => {
      const touched = new Map<Id, Record<string, Json> | null>();
      for (const [op, id, field, value] of c.facts) {
        if (!touched.has(id)) {
          const had = items.get(id) ?? links.get(id);
          touched.set(id, had ? { type: had.type, ...had.fields } : {});
        }
        const f = touched.get(id) ?? {};
        if (op === "+") f[field] = value;
        else delete f[field];
        touched.set(id, f);
      }
      const known = (t: unknown) => typeof t === "string" && (byType.has(t) || linkTypes.some((l) => l.name === t));
      for (const [id, f] of touched) {
        items.delete(id);
        links.delete(id);
        if (!f || !known(f.type)) continue;
        const { type, ...fields } = f;
        put({ id, type: String(type), fields });
      }
      changed();
    };

    const loadTypes = () => {
      const all = typesRead.all() ?? { types: [], links: [] };
      byType = new Map(all.types.map((t) => [t.name, t]));
      linkTypes = all.links;
    };
    const load = async () => {
      loadTypes();
      const names = [...byType.keys(), ...linkTypes.map((l) => l.name)];
      const fresh: Item[] = [];
      for (const name of names) {
        let after: string | undefined;
        do {
          const page = await graph.of(name, { limit: 500, ...(after ? { after } : {}) });
          fresh.push(...page.items);
          after = page.next;
        } while (after);
      }
      items.clear();
      links.clear();
      for (const it of fresh) put(it);
      ready = true;
      changed();
      return names;
    };

    let stopLive: Dispose | undefined;
    const follow = async () => {
      const cursor = await graph.now();
      const names = await load();
      await stopLive?.();
      stopLive = live.watch({ types: names, after: cursor }, (c) => apply(c));
    };
    ctx.effect(() => () => void stopLive?.());
    typesRead.watch(() => void follow());
    await follow();

    ctx.provide<FindIndex>("find.index", (_caller, from) => ({
      ready: () => ready,
      item: (id) => items.get(id),
      linksOf: (id) => [...links.values()].filter((l) => l.from === id || l.to === id),
      types: () => [...byType.values()],
      links: () => linkTypes,
      type: (n) => byType.get(n),
      closed: (r) => closed(byType.get(r.type), r.fields.status),
      run: (q, limit) => run(index, q, limit),
      watch: (on) =>
        from.effect(() => {
          watchers.add(on);
          return () => watchers.delete(on);
        }),
    }));

    /** Looks at an item, and shows it in the view: the query stays if it draws the item, else it becomes near:<id>. */
    const jump = (id: Id) => {
      const q = here.get<string>(QUERY) ?? "";
      const next = jumpQuery(index, q, id);
      if (next !== q) set.set(QUERY, next);
      set.set(KEYS.item, id);
      if (!DRAWS.includes(here.get<string>(KEYS.view) ?? "")) set.set(KEYS.view, DRAWS[0]);
    };
    const Line = makeLine({ index, types: () => [...byType.values()], watchers, here, set, query: QUERY, jump });
    ctx.provide<FindLine>("find.line", () => ({ Line, jump }));

    ctx.effect(() => {
      const style = document.createElement("style");
      style.textContent = STYLE;
      document.head.append(style);
      return () => style.remove();
    });
    // Wherever the query is drawn: Map, and Field (which lights what it finds).
    const fill = ctx.get<SlotFill>("slot.fill");
    fill.fill({ slot: "top", name: "find", title: "Find", when: { "here.view": DRAWS[0]! }, view: Line });
    fill.fill({ slot: "top", name: "find-field", title: "Find", when: { "here.view": DRAWS[1]! }, view: Line });
  },
};

export default find;
