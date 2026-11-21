/**
 * The docs pack, server side: the reference, read from the packs running
 * here (read.ts), as `docs.read`. Each loaded pack's inject and provides
 * with the spec contract each key is in, its actions (`action.list`), the
 * kinds of item it defines (`types.read`), the places its nodes speak at
 * (`agent.tree`), its config, and what it is for (its README's first
 * sentence). When a pack changes, its reference does.
 *
 * - `docs.read.packs()`: every pack loaded now, in config-tree order.
 * - `docs.read.about(ids)`: what each of these packs is for, for packs
 *   read elsewhere (the page's).
 * - `docs.read.watch(on)`: `on` when packs come, go or change state, or
 *   their actions, types or nodes do.
 *
 * It reads the runtime it runs in (its fibers): installing a pack means
 * trusting it, and this one only looks. It invokes no action. The page's
 * Packs view (view.ts) draws it through the bridge; agents read it with
 * the `packs` tool (tool.ts).
 */
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ActionList } from "../../spec/action.ts";
import type { AgentTree } from "../../spec/agent.ts";
import type { TypesRead } from "../../spec/types.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { aboutOf, digest, KEY, reference, type DocsRead } from "./read.ts";

export { KEY, type DocsRead } from "./read.ts";

export interface DocsConfig {
  /** Which runtime this is, on each card. Default `server`. */
  side?: string;
  /** How often a change of a pack's state is looked for (ms). Default 1000. */
  every?: number;
  /** Where each pack's README is: `<packs>/<id>/README.md`. Default this repository's packs folder. */
  packs?: string;
}

const docs: Pack<DocsConfig> = {
  id: "docs",
  inject: ["action.list", "agent.tree", "types.read"],
  apply(ctx: Context, config: DocsConfig = {}) {
    const actions = ctx.get<ActionList>("action.list");
    const tree = ctx.get<AgentTree>("agent.tree");
    const types = ctx.get<TypesRead>("types.read");
    const side = config.side ?? "server";
    const folder = config.packs ? pathToFileURL(config.packs.replace(/[\\/]?$/, "/")) : new URL("../", import.meta.url);
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
    // A fiber's state has no event of its own: look for a change.
    let last = digest(ctx.runtime);
    ctx.effect(() => {
      const timer = setInterval(() => {
        const now = digest(ctx.runtime);
        if (now !== last) {
          last = now;
          fire();
        }
      }, config.every ?? 1000);
      return () => clearInterval(timer);
    });

    /** Each pack's README, read when asked: an edit shows at once. A pack id is a folder name, nothing more. */
    const about = async (ids: string[]) => {
      const out: Record<string, string> = {};
      await Promise.all(
        [...new Set(ids)]
          .filter((id) => /^[a-z0-9][a-z0-9-]*$/.test(id))
          .map(async (id) => {
            const md = await readFile(new URL(`${id}/README.md`, folder), "utf8").catch(() => undefined);
            const line = md && aboutOf(md);
            if (line) out[id] = line;
          }),
      );
      return out;
    };

    ctx.provide<DocsRead>(KEY, (_caller, from) => ({
      packs: async () => {
        const ids = [...ctx.runtime.fibers].map((f) => f.pack.id);
        return reference(ctx.runtime, { side, actions: actions.list(), nodes: tree.nodes(), types: types.all(), about: await about(ids) });
      },
      about,
      watch: (on) =>
        from.effect(() => {
          listeners.add(on);
          return () => listeners.delete(on);
        }),
    }));
  },
};

export default docs;
