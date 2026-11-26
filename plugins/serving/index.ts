/**
 * The serving plugin, server side: which code and which map this server is,
 * so two servers never look the same on the page (view.ts).
 *
 * - `serving.about`: `{ map, commit, checkout, port }`. `map` is the map's
 *   name when the server serves one by name (app/server.ts `--map`), else
 *   absent; `commit` short, with `+` when the checkout has changes;
 *   `checkout` the folder the code runs from, absent behind a host. Read only.
 *
 * Config: `map`, `commit`, `checkout`, `port` (app/tree.ts sets them).
 * Injects action.register.
 */
import type { ActionRegister } from "../../spec/action.ts";
import type { Context, Plugin } from "../../runtime/core.ts";

export const ABOUT = "serving.about";

export interface ServingConfig {
  map?: string;
  commit?: string;
  checkout?: string;
  port?: number;
}

export type About = ServingConfig;

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
    };
    ctx.get<ActionRegister>("action.register").register({
      name: ABOUT,
      title: "Which map, commit and checkout this server is",
      doc: "The map's name (when served by name), the commit, the checkout and the page's port. Read only.",
      input: { type: "object", properties: {} },
      async run() {
        return about as Record<string, string | number>;
      },
    });
  },
};

export default serving;
