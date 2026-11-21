/**
 * The switch pack, server side: `switch.set`, turning packs on and off on
 * the page and on the server as one change set, and the server's half of
 * following it (packs/switch/README.md).
 *
 * The page's packs are the `page` item `page.set` writes (packs/page), and
 * the page follows it as ever. The server's are an item of the flavour
 * `server`, the same shape, which this pack lays over the tree the server
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
import type { Context, Pack } from "../../runtime/core.ts";
import { record } from "../page/index.ts";
import { overlay, TYPE as PAGE_TYPE, type Changes, type SetInput } from "../page/overlay.ts";

export const SET = "switch.set";
export const TYPE = "server";

/** The flavour: one item holds the server's packs as a person changed them. */
export const SERVER: FlavourDef = {
  name: TYPE,
  base: "record",
  doc: "The server's packs as a person changed them: on and off.",
  trial: false,
  fields: { packs: { kind: "json", doc: "Entry id to its change: { off }." } },
};

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

const sw: Pack = {
  id: "switch",
  about: "Turns a pack on or off, on the page and the server, as a change that can be undone.",
  inject: ["types.define", "graph.read", "graph.watch", "action.register", "loader.tree"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").flavour(SERVER);
    const graph = ctx.get<GraphRead>("graph.read");
    const loader = ctx.get<LoaderTree>("loader.tree");

    ctx.get<ActionRegister>("action.register").register({
      name: SET,
      title: "Turn packs on or off, on the page and the server",
      doc: "page and server are entry ids of each runtime's config tree; on turns them on or off (null: as the template has it). One change set: history.undo takes it all back. The Packs view's switch calls it.",
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
        const as = (ids: string[]): SetInput[] => ids.map((pack) => ({ pack, on: input.on }));
        const out: { [k: string]: Json } = {};
        if (page.length) out.page = (await record(graph, call, PAGE_TYPE, "The page's packs", as(page))).packs as unknown as Json;
        if (server.length) out.server = (await record(graph, call, TYPE, "The server's packs", as(server))).packs as unknown as Json;
        return out;
      },
    });

    // Follow the item: the tree the server started with, the changes laid over it.
    let last = "";
    const follow = async () => {
      const [item] = (await graph.of(TYPE, { limit: 1 })).items;
      const changes = (item?.fields.packs ?? {}) as unknown as Changes;
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
