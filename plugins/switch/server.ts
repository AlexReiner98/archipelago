/**
 * The switch plugin, server side: `switch.set`, turning plugins on and off on
 * the page and on the server as one change set, and the server's half of
 * following it (plugins/switch/README.md).
 *
 * The page's plugins are the `page` item `page.set` writes (plugins/page), and
 * the page follows it as ever. The server's are an item of the flavour
 * `server`, the same shape, which this plugin lays over the tree the server
 * started with (`loader.tree` base) whenever it changes. Undo the change
 * and both follow back.
 *
 * Injects types.define for the flavour, graph.read and graph.watch to find
 * and follow the item, action.register, and loader.tree to apply it.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import type { LoaderTree } from "../../spec/loader.ts";
import type { FlavourDef, TypesDefine } from "../../spec/types.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { fieldNow } from "../graph/renamed.ts";
import { record } from "../page/index.ts";
import { overlay, TYPE as PAGE_TYPE, type Changes, type SetInput } from "../page/overlay.ts";

export const SET = "switch.set";
export const TYPE = "server";

/** The flavour: one item holds the server's plugins as a person changed them. */
export const SERVER: FlavourDef = {
  name: TYPE,
  base: "record",
  doc: "The server's plugins as a person changed them: on and off.",
  trial: false,
  fields: { plugins: { kind: "json", doc: "Entry id to its change: { off }." } },
};

/**
 * Server plugins the switch never turns off: the way back. Off, any of these
 * would leave nothing to turn it on again (the store, the write path and
 * its types, the switch, undo, the bridge the page talks through, the
 * Plugins view's reads, the agents' way in), and the off state is kept on
 * the graph, so it would come back at every start. A host adds its own
 * (`locked` in config: its sign-in and gateway).
 */
export const LOCKED = ["graph", "action", "types", "page", "switch", "history", "bridge", "docs", "docs-tool", "mcp"];

export interface SwitchConfig {
  /** More server entry ids the switch never turns off. */
  locked?: string[];
}

/** The ids of `asked` that are locked, given the host's own. */
export const refused = (asked: string[], more: string[] = []) => asked.filter((id) => LOCKED.includes(id) || more.includes(id));

/** Changes with every locked entry's "off" dropped: an old or hand-made item can't turn one off at start. */
export function unlocked(changes: Changes, more: string[] = []): Changes {
  const out: Changes = {};
  for (const [id, c] of Object.entries(changes)) if (!refused([id], more).length || !(c as { off?: boolean }).off) out[id] = c;
  return out;
}

/** What `switch.set` takes. */
export interface SwitchInput {
  /** Entry ids of the page's tree (app/boot.ts). */
  page?: string[];
  /** Entry ids of the server's tree (app/tree.ts). */
  server?: string[];
  /** On or off; `null`: as the template has it. */
  on: boolean | null;
  [key: string]: Json | undefined;
}

const sw: Plugin<SwitchConfig> = {
  id: "switch",
  about: "Turns a plugin on or off, on the page and the server, as a change that can be undone.",
  inject: ["types.define", "graph.read", "graph.watch", "action.register", "loader.tree"],
  apply(ctx: Context, config: SwitchConfig = {}) {
    const more = config.locked ?? [];
    ctx.get<TypesDefine>("types.define").flavour(SERVER);
    const graph = ctx.get<GraphRead>("graph.read");
    const loader = ctx.get<LoaderTree>("loader.tree");

    ctx.get<ActionRegister>("action.register").register({
      name: SET,
      title: "Turn plugins on or off, on the page and the server",
      doc: "page and server are entry ids of each runtime's config tree; on turns them on or off (null: as the template has it). One change set: history.undo takes it all back. The Plugins view's switch calls it.",
      input: {
        type: "object",
        properties: {
          page: { type: "array", items: { type: "string" }, description: "Entry ids of the page's tree." },
          server: { type: "array", items: { type: "string" }, description: "Entry ids of the server's tree." },
          on: { type: ["boolean", "null"] },
        },
        required: ["on"],
      },
      async run(input: SwitchInput, call: ActionContext) {
        const page = input.page ?? [];
        const server = input.server ?? [];
        const no = input.on === false ? refused(server, more) : [];
        if (no.length) throw new Error(`These server plugins are the way back and can't be turned off: ${no.join(", ")}.`);
        const as = (ids: string[]): SetInput[] => ids.map((plugin) => ({ plugin, on: input.on }));
        const out: { [k: string]: Json } = {};
        if (page.length) out.page = (await record(graph, call, PAGE_TYPE, "The page's plugins", as(page))).plugins as unknown as Json;
        if (server.length) out.server = (await record(graph, call, TYPE, "The server's plugins", as(server))).plugins as unknown as Json;
        return out;
      },
    });

    // Follow the item: the tree the server started with, the changes laid over it.
    let last = "";
    const follow = async () => {
      const [item] = (await graph.of(TYPE, { limit: 1 })).items;
      const changes = unlocked((fieldNow(item?.fields, "plugins") ?? {}) as unknown as Changes, more);
      const key = JSON.stringify(changes);
      if (key === last) return;
      last = key;
      const next = overlay(loader.base(), changes);
      if (JSON.stringify(next) !== JSON.stringify(loader.tree())) await loader.edit(() => next);
    };
    const run = () => void follow().catch((err) => ctx.runtime.report(ctx.fiber, err));
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, run);
    run();
  },
};

export default sw;
