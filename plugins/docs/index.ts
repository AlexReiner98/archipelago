/**
 * The docs plugin, server side: the reference, read from the plugins running
 * here (read.ts), as `docs.read`. Each loaded plugin's inject and provides
 * with the spec contract each key is in, its actions (`action.list`), the
 * kinds of item it defines (`types.read`) and how many of each the map
 * holds (`graph.read`), the places its nodes speak at (`agent.tree`), what
 * it did in the newest run (`exchange.read`), its config, what it says it
 * is for (its `about`) and whether it was loaded from this repository.
 *
 * - `docs.read.plugins()`: every plugin loaded now, in config-tree order.
 * - `docs.read.guide()`, `docs.read.chapter(path)`: the guide, read from
 *   the repository's Markdown files as they are now (files.ts).
 * - `docs.read.watch(on)`: `on` when plugins come, go or change state, their
 *   actions, types or nodes do, or the map or the exchange moves (at most
 *   once a second for those two).
 *
 * Reads are bounded: one page of at most KIND_PAGE items per kind (more
 * shows as `more`), the newest run only, one page of its events.
 *
 * It reads the runtime it runs in (its fibers): installing a plugin means
 * trusting it, and this one only looks. It invokes no action. The page's
 * Plugins view (view.ts) draws it through the bridge; agents read it with
 * the `plugins` tool (tool.ts).
 */
import type { ActionList } from "../../spec/action.ts";
import type { AgentTree } from "../../spec/agent.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import type { LoaderTree } from "../../spec/loader.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { TypesRead } from "../../spec/types.ts";
import type { Context, Plugin, Runtime } from "../../runtime/core.ts";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { guide, read } from "./files.ts";
import { origins, type Git, type Origins } from "./origin.ts";
import { activityOf, digest, failures, KEY, reference, Seen, type DocsRead, type Origin, type PluginDoc } from "./read.ts";

export { KEY, type DocsRead } from "./read.ts";

/** This repository's root: a plugin loaded from under it is built in. */
export const ROOT = new URL("../../", import.meta.url).href;
/** How many items of a kind are counted; past it, a count says "or more". */
export const KIND_PAGE = 100;

export interface DocsConfig {
  /** Which runtime this is, on each card. Default `server`. */
  side?: string;
  /** How often a change of a plugin's state is looked for (ms). Default 1000. */
  every?: number;
  /** The server's log file, when it may write one (`<data>/server.log`): a failure says to look there. */
  log?: string;
  /** Runs git, for where each plugin came from (origin.ts); replaced in tests. */
  git?: Git;
}

/** How many items of each kind the map holds, from one bounded page each. */
async function counted(graph: GraphRead, docs: PluginDoc[]): Promise<void> {
  const kinds = docs.flatMap((d) => (d.types ?? []).filter((t) => t.base !== "link"));
  await Promise.all(
    kinds.map(async (t) => {
      const page = await graph.of(t.name, { limit: KIND_PAGE }).catch(() => undefined);
      if (!page) return;
      t.count = page.items.length;
      if (page.next) t.more = true;
    }),
  );
}

/** What each plugin did in the newest run: one page of its events. */
async function active(exchange: ExchangeRead, docs: PluginDoc[]): Promise<void> {
  const runs = await exchange.runs({ limit: 1 }).catch(() => undefined);
  const run = runs?.items[0]?.run;
  if (!run) return;
  const events = await exchange.events(run, { limit: LIMIT_MAX }).catch(() => undefined);
  const by = activityOf(run, events?.items ?? []);
  for (const d of docs) {
    const a = by.get(d.id);
    if (a) d.activity = a;
  }
}

/** Each plugin's origin, from its fiber's module, or for one that failed to import, the module its entry names. */
async function placed(origins: Origins, runtime: Runtime, docs: PluginDoc[]): Promise<void> {
  const byPosition = new Map<string, string>();
  for (const f of runtime.fibers) if (f.source && f.parent === runtime.rootFiber) byPosition.set(f.position().join("."), f.source);
  const sourceOf = (d: PluginDoc) => byPosition.get(d.position.join(".")) ?? (d.where?.module ? new URL(d.where.module, ROOT).href : undefined);
  const sources = docs.map(sourceOf);
  const got = await origins.of(sources.filter((s): s is string => !!s)).catch(() => new Map<string, Origin>());
  docs.forEach((d, i) => {
    const o = sources[i] && got.get(sources[i]!);
    if (o) d.origin = o;
  });
}

/** Where the server's errors go: its log file when this process writes it (it changed since it started), else its output. */
async function logOf(file: string | undefined, started: number): Promise<string> {
  const s = file ? await stat(file).catch(() => undefined) : undefined;
  return s && s.mtimeMs >= started - 5000 ? file! : "the server's output, in the terminal it runs in";
}

const docs: Plugin<DocsConfig> = {
  id: "docs",
  about: "Shows every running plugin: what it is for and what it adds.",
  inject: ["action.list", "agent.tree", "types.read", "graph.read", "graph.watch", "exchange.read", "exchange.watch", "loader.tree"],
  apply(ctx: Context, config: DocsConfig = {}) {
    const actions = ctx.get<ActionList>("action.list");
    const tree = ctx.get<AgentTree>("agent.tree");
    const types = ctx.get<TypesRead>("types.read");
    const graph = ctx.get<GraphRead>("graph.read");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    // Read only: each entry's id and state, so a card knows what turns it on and off.
    const loader = ctx.get<LoaderTree>("loader.tree");
    const side = config.side ?? "server";
    const every = config.every ?? 1000;
    const listeners = new Set<() => void>();
    const fire = () => {
      for (const on of [...listeners]) {
        try {
          on();
        } catch (err) {
          ctx.runtime.report(ctx.fiber, err);
        }
      }
    };
    actions.watch(fire);
    tree.watch(fire);
    types.watch(fire);
    // The map and the exchange move often: tell at most once per `every`.
    let moved = false;
    const soon = () => void (moved = true);
    ctx.get<GraphWatch>("graph.watch").watch({}, soon);
    ctx.get<ExchangeWatch>("exchange.watch").watch({}, soon);
    // A fiber's state has no event of its own: look for a change.
    let last = digest(ctx.runtime);
    ctx.effect(() => {
      const timer = setInterval(() => {
        const now = digest(ctx.runtime);
        if (now !== last || moved) {
          last = now;
          moved = false;
          fire();
        }
      }, every);
      return () => clearInterval(timer);
    });

    // When each failure was first seen: looked for when the tree changes and on every tick.
    const seen = new Seen();
    const look = () => seen.note(failures(ctx.runtime, side, loader.status()));
    look();
    loader.watch(() => (look(), fire()));
    ctx.effect(() => {
      const timer = setInterval(look, every);
      return () => clearInterval(timer);
    });
    const sourced = origins(ROOT, config.git ? { git: config.git } : {});
    const started = Date.now();
    const log = () => logOf(config.log, started);

    ctx.provide<DocsRead>(KEY, (_caller, from) => ({
      plugins: async () => {
        look();
        const docs = reference(ctx.runtime, {
          side,
          root: ROOT,
          actions: actions.list(),
          nodes: tree.nodes(),
          types: types.all(),
          entries: loader.status(),
          tree: loader.tree(),
          seen: seen.at,
          log: await log(),
        });
        await Promise.all([counted(graph, docs), active(exchange, docs), placed(sourced, ctx.runtime, docs)]);
        return docs;
      },
      origins: async (folders) => {
        const names = [...new Set(folders)].filter((f) => /^[\w.-]+$/.test(f)).slice(0, 200);
        const urls = names.map((f) => new URL(`plugins/${f}/README.md`, ROOT).href);
        const got = await sourced.of(urls);
        return Object.fromEntries(names.flatMap((f, i) => (got.has(urls[i]!) ? [[f, got.get(urls[i]!)!]] : [])));
      },
      guide: () => guide(fileURLToPath(ROOT)),
      chapter: (path) => read(fileURLToPath(ROOT), path),
      watch: (on) =>
        from.effect(() => {
          listeners.add(on);
          return () => listeners.delete(on);
        }),
    }));
  },
};

export default docs;
