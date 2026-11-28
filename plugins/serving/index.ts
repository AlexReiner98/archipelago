/**
 * The serving plugin, server side: which code and which map this server is,
 * so two servers never look the same on the page (view.ts).
 *
 * - `serving.about`: `{ map, commit, checkout, port }`. `map` is the map's
 *   name when the server serves one by name (app/server.ts `--map`), else
 *   absent; `commit` short, with `+` when the checkout has changes;
 *   `checkout` the folder the code runs from, absent behind a host;
 *   `folders` the plugin folders it loaded, where the list came from
 *   (`flag`, `env` or `map`) and each named one that didn't load, absent
 *   behind a host; `switch.current`, for a map served by name, the map the
 *   switch names (registry.ts `currentOf`, `npm run map -- use`), read at
 *   each call, so the page says whether sessions report here. Read only.
 *
 * Config: `map`, `commit`, `checkout`, `port`, `folders`, `sayCurrent` (app/tree.ts sets them).
 * Injects action.register.
 */
import type { ActionRegister } from "../../spec/action.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { currentOf, type PluginFolders } from "../claude-code/registry.ts";

export const ABOUT = "serving.about";

export interface ServingConfig {
  map?: string;
  commit?: string;
  checkout?: string;
  port?: number;
  folders?: PluginFolders;
  /** Whether to say the switch (this machine's `current`): a local server only. */
  sayCurrent?: boolean;
}

/**
 * What `serving.about` answers: the config, and for a map served by name the
 * switch (`switch.current`: the map every session connected to `current`
 * reaches, absent when none is), read at each call.
 */
export type About = Omit<ServingConfig, "sayCurrent"> & { switch?: { current?: string } };

const serving: Plugin<ServingConfig> = {
  id: "serving",
  about: "Says which map, commit and checkout this server is.",
  inject: ["action.register"],
  apply(ctx: Context, config: ServingConfig = {}) {
    const about: About = {
      ...(config.map ? { map: config.map } : {}),
      ...(config.commit ? { commit: config.commit } : {}),
      ...(config.checkout ? { checkout: config.checkout } : {}),
      ...(config.port ? { port: config.port } : {}),
      ...(config.folders ? { folders: config.folders } : {}),
    };
    ctx.get<ActionRegister>("action.register").register({
      name: ABOUT,
      title: "Which map, commit and checkout this server is",
      doc: "The map's name (when served by name), the commit, the checkout, the page's port, and the plugin folders it loaded (and from where). Read only.",
      input: { type: "object", properties: {} },
      async run() {
        if (!about.map || !config.sayCurrent) return about as unknown as Record<string, string | number>;
        const current = currentOf();
        return { ...about, switch: current ? { current } : {} } as unknown as Record<string, string | number>;
      },
    });
  },
};

export default serving;
