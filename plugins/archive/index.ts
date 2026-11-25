/**
 * The archive plugin: old maps kept read only, each a graph store of its own
 * (`<dir>/<name>.sqlite`, plugins/graph/store.ts), opened so that nothing can
 * write to it. Each is added to the agent's `get` and `query` tools through
 * `mcp.maps`, under its file's name. There is no action here: an archive
 * changes only by being made again from its source, offline.
 *
 * Injects `mcp.maps`. Node only.
 */
import type { Context, Plugin } from "../../runtime/core.ts";
import { Store } from "../graph/store.ts";
import type { McpMaps } from "../mcp/maps.ts";
import { MAPS } from "../mcp/maps.ts";

export interface ArchiveConfig {
  /** The folder of archives; each `<name>.sqlite` in it is one. */
  dir?: string;
}

/** What an archive's file may be called: its name is how a call names it. */
export const NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

const archive: Plugin<ArchiveConfig> = {
  id: "archive",
  about: "Keeps old maps readable, and never changes them.",
  inject: [MAPS],
  async apply(ctx: Context, config: ArchiveConfig = {}) {
    if (!config.dir) return;
    const { readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    let files: string[] = [];
    try {
      files = await readdir(config.dir);
    } catch {
      return;
    }
    const maps = ctx.get<McpMaps>(MAPS);
    for (const file of files.sort()) {
      const name = file.replace(/\.sqlite$/, "");
      if (name === file || !NAME.test(name)) continue;
      let store: Store;
      try {
        store = new Store(join(config.dir, file), 0, { readOnly: true });
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
        continue;
      }
      ctx.effect(() => () => store.close());
      const title = (store.db.prepare("SELECT value FROM meta WHERE key = 'title'").get() as { value: string } | undefined)?.value;
      maps.add({
        name,
        ...(title ? { title } : {}),
        read: {
          get: async (ids) => store.get(ids),
          links: async (id, opts, page) => store.links(id, opts, page),
          all: async (page) => store.all(page),
        },
      });
    }
  },
};

export default archive;
