/**
 * The loaded pack: what a harness loads into a run, as nodes. A skill's text
 * or a memory file (a CLAUDE.md, a MEMORY.md) shapes the run as much as
 * anything the map says, so each is a node said at its place and judged per
 * run like any node, and shows in the harness view's tree.
 *
 * - Places: `skill:<name>` when a skill's text loads, `memory:<scope>/<path>`
 *   when a memory file does (scope: project, local, user, auto, managed).
 *   They are open-vocabulary places (spec/agent.ts): reached to record what
 *   was loaded, not to hand anything back.
 * - Nodes: each graph item of type `loaded` ({ title, kind: skill | memory,
 *   place, path? }) is a node at its one place that says what was loaded
 *   there: the moment's input `text`. The items outlive restarts, so the
 *   tree keeps every skill and memory file a run has loaded.
 * - The action `loaded.note` ({ place, kind, title, path? }) makes the item
 *   the first time a place is seen, and changes nothing after. The adapter
 *   calls it before it reaches the place, so the node is there to say it.
 * - Adopted: once the map writes the file (packs/written), the item's
 *   `adopted` names the map's node, which says it instead; this pack then
 *   registers nothing there.
 *
 * Injects graph.read and graph.watch to follow the items, agent.node to
 * register them, action.register for `loaded.note`.
 */
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { AgentNode } from "../../spec/agent.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Dispose, Id, Json } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";

export const TYPE = "loaded";
export const NOTE = "loaded.note";
export const KINDS = ["skill", "memory"] as const;
export type LoadKind = (typeof KINDS)[number];

export interface NoteInput {
  place: string;
  kind: LoadKind;
  title: string;
  /** Where it was loaded from, when the harness says. */
  path?: string;
}

/** The family a load of this kind is said at. */
const familyOf = (kind: LoadKind) => `${kind}:`;

const refuse = (code: string, message: string) => new Refused({ code, message, by: { pack: "loaded" } });

/** What was loaded: the moment's input `text`, or the input itself when it is text. */
function loadedText(input: Json | undefined): string | undefined {
  if (typeof input === "string") return input.trim() || undefined;
  if (input && typeof input === "object" && !Array.isArray(input) && typeof input.text === "string") return input.text.trim() || undefined;
  return undefined;
}

const loaded: Pack = {
  id: "loaded",
  inject: ["graph.read", "graph.watch", "agent.node", "action.register"],
  async apply(ctx: Context) {
    const graph = ctx.get<GraphRead>("graph.read");
    const agent = ctx.get<AgentNode>("agent.node");
    /** Every item's fields as this pack last saw them, kept from the change sets themselves. */
    const fields = new Map<Id, Record<string, Json>>();
    const registered = new Map<Id, { dispose: Dispose; shape: string }>();

    const placeOf = (f: Record<string, Json> | undefined) => (f?.type === TYPE && typeof f.place === "string" && f.place ? f.place : undefined);
    const byPlace = (place: string) => [...fields].find(([, f]) => placeOf(f) === place)?.[0];

    const sync = (id: Id) => {
      const f = fields.get(id);
      const place = placeOf(f);
      // Adopted (packs/written): the map's own node says it, not this record.
      const adopted = typeof f?.adopted === "string" ? f.adopted : undefined;
      const shape = JSON.stringify([place, f?.title, f?.kind, adopted]);
      const had = registered.get(id);
      if (had?.shape === shape) return;
      if (had) {
        void had.dispose();
        registered.delete(id);
      }
      if (!place || adopted) return;
      const title = String(f!.title ?? place);
      const dispose = agent.node({
        name: id,
        kind: f!.kind === "memory" ? "memory" : "skill",
        title,
        at: [place],
        source: id,
        speak: (moment) => ({ say: loadedText(moment.input) ?? `Loaded ${title}.` }),
      });
      registered.set(id, { dispose, shape });
    };

    // Follow the graph first, then read what is there. A watcher hears a
    // change set as it commits, so the node is registered before
    // `loaded.note` returns, and the adapter's reach right after finds it.
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, (change) => {
      const touched = new Set<Id>();
      for (const [op, id, field, value] of change.facts) {
        const f = fields.get(id) ?? {};
        if (op === "+") f[field] = value;
        else if (f[field] !== undefined && JSON.stringify(f[field]) === JSON.stringify(value)) delete f[field];
        fields.set(id, f);
        touched.add(id);
      }
      for (const id of touched) {
        if (!Object.keys(fields.get(id)!).length) fields.delete(id);
        sync(id);
      }
    });
    for (let page = await graph.of(TYPE, { limit: LIMIT_MAX }); ; page = await graph.of(TYPE, { limit: LIMIT_MAX, after: page.next })) {
      for (const item of page.items) {
        if (!fields.has(item.id)) fields.set(item.id, { ...item.fields, type: item.type });
        sync(item.id);
      }
      if (!page.next) break;
    }

    ctx.get<ActionRegister>("action.register").register({
      name: NOTE,
      title: "Note a skill or memory file the harness loaded",
      doc: "Makes the node that says it the first time its place is seen; changes nothing after.",
      input: {
        type: "object",
        properties: {
          place: { type: "string", description: "skill:<name> or memory:<scope>/<path>" },
          kind: { type: "string", enum: [...KINDS] },
          title: { type: "string" },
          path: { type: "string", description: "Where it was loaded from" },
        },
        required: ["place", "kind", "title"],
      },
      async run(input: NoteInput, call: ActionContext) {
        if (!KINDS.includes(input.kind)) throw refuse("loaded.kind", `A load is a skill or a memory, not ${JSON.stringify(input.kind)}.`);
        const place = String(input.place ?? "");
        if (!place.startsWith(familyOf(input.kind)) || place.length <= familyOf(input.kind).length || place.includes("*")) {
          throw refuse("loaded.place", `A ${input.kind} is said at one exact ${familyOf(input.kind)}<…> place, not ${JSON.stringify(input.place)}.`);
        }
        const known = byPlace(place);
        if (known) {
          const adopted = fields.get(known)?.adopted;
          return { node: typeof adopted === "string" ? adopted : known };
        }
        const id = `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const facts: Fact[] = [
          ["+", id, "type", TYPE],
          ["+", id, "title", String(input.title || place).slice(0, 120)],
          ["+", id, "kind", input.kind],
          ["+", id, "place", place],
        ];
        if (input.path) facts.push(["+", id, "path", input.path]);
        call.write(facts);
        return { node: id };
      },
    });
  },
};

export default loaded;
