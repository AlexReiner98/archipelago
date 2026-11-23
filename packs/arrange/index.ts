/**
 * Arrange: the Landscape arranged into a context profile's tree. When the
 * find line names a profile (`profile:Copy`), this pack asks which nodes a
 * run in only that profile hears (`profile.read`), lays them out as the
 * Context interface does, and sets the page key `arrange.tree`: each item
 * on the map the tree holds and its place, the branches, the boughs' names
 * and the nodes no item holds. The Landscape (packs/field) keeps only those
 * items and pulls each to its place (its `tree` behaviour), so the map's
 * own items are seen to make the profile's tree. With no profile named, the
 * key is cleared and the Landscape is itself again.
 */
import type { AgentTree, NodeInfo, RunInfo } from "../../spec/agent.ts";
import type { Id, Json } from "../../spec/common.ts";
import type { HereDeclare, HereRead, HereSet } from "../../spec/here.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { ARRANGE, arrange, profileTerm } from "./arrange.ts";

export { ARRANGE } from "./arrange.ts";

const QUERY = "find.query";

interface Row {
  id: Id;
  type: string;
  fields: Record<string, Json>;
}
interface FindIndex {
  item(id: Id): Row | undefined;
  run(query: string, limit?: number): { items: Row[] };
  watch(on: () => void): () => void;
}

const arrangePack: Pack = {
  id: "arrange",
  about: "Arranges the Landscape into a context profile's tree when the find line names one (profile:<title>).",
  inject: ["find.index", "here.read", "here.set", "here.declare", "agent.tree", "profile.read"],
  apply(ctx: Context) {
    const index = ctx.get<FindIndex>("find.index");
    const here = ctx.get<HereRead>("here.read");
    const set = ctx.get<HereSet>("here.set");
    const tree = ctx.get<AgentTree>("agent.tree");
    const profiles = ctx.get<ProfileRead>("profile.read");
    ctx.effect(() => ctx.get<HereDeclare>("here.declare").declare({ key: ARRANGE, scope: "page", doc: "The Landscape arranged into a context profile's tree: its items and their places, its branches and boughs (packs/arrange)." }));

    let asked = 0;
    const update = async () => {
      const n = ++asked;
      const title = profileTerm(String(here.get(QUERY) ?? ""));
      const profile = title ? index.run("type:profile", 500).items.find((r) => String(r.fields.title ?? "").toLowerCase() === title.toLowerCase()) : undefined;
      if (!profile) return void (here.get(ARRANGE) !== undefined && set.set(ARRANGE, undefined));
      // A run in only that profile, as the Context interface asks for a profile looked at.
      const as: RunInfo = { run: `profile:${profile.id}`, agent: { kind: "agent", id: "profile" } as RunInfo["agent"], harness: "", reaches: [], started: "", facts: { profiles: [profile.id] } };
      const nodes = tree.nodes();
      const heard: NodeInfo[] = [];
      await Promise.all(nodes.map(async (node) => (await profiles.hears(as, node)).hears && heard.push(node)));
      if (n !== asked) return;
      const a = arrange(String(profile.fields.title ?? title), heard, (id) => !!index.item(id));
      // The same tree again sets nothing: the Landscape is not stirred by a map change it doesn't show.
      if (JSON.stringify(here.get(ARRANGE)) !== JSON.stringify(a)) set.set(ARRANGE, a as unknown as Json);
    };
    const again = () => void update();
    ctx.effect(() => here.watch(QUERY, again));
    ctx.effect(() => index.watch(again));
    ctx.effect(() => tree.watch(again));
    ctx.effect(() => profiles.watch(again));
    again();
  },
};

export default arrangePack;
