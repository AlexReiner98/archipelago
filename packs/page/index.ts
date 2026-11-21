/**
 * The page pack, server side: `page.set`, the action a person or an agent
 * changes the page's packs with (packs/page/README.md). It writes one item
 * of the flavour `page`, whose field `packs` holds every change; the page
 * applies it (view.ts). Being a change to the graph, it is journaled, and
 * `history.undo` takes it back.
 *
 * Injects types.define for the flavour, graph.read to find the item, and
 * action.register.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Json } from "../../spec/common.ts";
import type { GraphRead } from "../../spec/graph.ts";
import type { TypesDefine } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { merge, PAGE, TYPE, type Changes, type SetInput } from "./overlay.ts";

export const SET = "page.set";

/**
 * Lays `inputs` over the one item of `type` (made the first time) and
 * writes it into the change set being built: what `page.set` does, shared
 * with any action that changes the page's packs together with something
 * else in one change set (the switch pack's `switch.set`).
 */
export async function record(graph: GraphRead, call: ActionContext, type: string, title: string, inputs: SetInput[]): Promise<{ id: string; packs: Changes }> {
  const [item] = (await graph.of(type, { limit: 1 })).items;
  const now = (item?.fields.packs ?? {}) as unknown as Changes;
  const next = inputs.reduce(merge, now);
  const id = item?.id ?? `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  if (!item) {
    call.write([
      ["+", id, "type", type],
      ["+", id, "title", title],
      ["+", id, "status", "current"],
    ]);
  }
  if (item?.fields.packs !== undefined) call.write([["-", id, "packs", item.fields.packs]]);
  call.write([["+", id, "packs", next as unknown as Json]]);
  return { id, packs: next };
}

const page: Pack = {
  id: "page",
  about: "Turns the page's packs on and off, as a change that can be undone.",
  inject: ["types.define", "graph.read", "action.register"],
  apply(ctx: Context) {
    ctx.get<TypesDefine>("types.define").flavour(PAGE);
    const graph = ctx.get<GraphRead>("graph.read");

    ctx.get<ActionRegister>("action.register").register({
      name: SET,
      title: "Change the page's packs: on, off, config, order",
      doc: "pack is an entry id of the page's tree (renderer, frame, views, map, item…). on turns it on or off (null: as the template has it); config lays keys over its config (null clears); after places it after a sibling (\"\" first, null back). The renderer's config.arrange moves fills: { \"item/page\": \"left\" } or \"off\".",
      input: {
        type: "object",
        properties: {
          pack: { type: "string", description: "An entry id of the page's tree." },
          on: { type: ["boolean", "null"] },
          config: { type: ["object", "null"] },
          after: { type: ["string", "null"] },
        },
        required: ["pack"],
      },
      async run(input: SetInput, call: ActionContext) {
        const out = await record(graph, call, TYPE, "The page's packs", [input]);
        return { page: out.id, packs: out.packs as unknown as Json };
      },
    });
  },
};

export default page;
