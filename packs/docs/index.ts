/**
 * The docs pack, server side: the reference, read from the packs running
 * here (read.ts), as `docs.read`. Each loaded pack's inject and provides
 * with the spec contract each key is in, its actions (`action.list`), the
 * places its nodes speak at (`agent.tree`) and its config. Never typed by
 * hand: when a pack changes, its reference does.
 *
 * - `docs.read.packs()`: every pack loaded now, in config-tree order.
 * - `docs.read.watch(on)`: `on` when packs come, go or change state, or
 *   their actions or nodes do.
 *
 * It reads the runtime it runs in (its fibers): installing a pack means
 * trusting it, and this one only looks. It invokes no action. The page's
 * Packs view (view.ts) draws it through the bridge; agents read it with
 * the `packs` tool (tool.ts).
 */
import type { ActionList } from "../../spec/action.ts";
import type { AgentTree } from "../../spec/agent.ts";
import type { Dispose } from "../../spec/common.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { digest, reference, type PackDoc } from "./read.ts";

export const KEY = "docs.read";

/** `docs.read`: the docs pack's own key, like `verdict.read`. */
export interface DocsRead {
  packs(): Promise<PackDoc[]>;
  watch(on: () => void): Dispose;
}

export interface DocsConfig {
  /** Which runtime this is, on each card. Default `server`. */
  side?: string;
  /** How often a change of a pack's state is looked for (ms). Default 1000. */
  every?: number;
}

const docs: Pack<DocsConfig> = {
  id: "docs",
  inject: ["action.list", "agent.tree"],
  apply(ctx: Context, config: DocsConfig = {}) {
    const actions = ctx.get<ActionList>("action.list");
    const tree = ctx.get<AgentTree>("agent.tree");
    const side = config.side ?? "server";
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

    ctx.provide<DocsRead>(KEY, (_caller, from) => ({
      packs: async () => reference(ctx.runtime, { side, actions: actions.list(), nodes: tree.nodes() }),
      watch: (on) =>
        from.effect(() => {
          listeners.add(on);
          return () => listeners.delete(on);
        }),
    }));
  },
};

export default docs;
