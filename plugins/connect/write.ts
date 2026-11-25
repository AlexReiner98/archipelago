/**
 * The connect writer: each connection that is on (folders.ts) written into
 * its folder's files, the hooks and MCP server that make its Claude Code
 * sessions report to this map (here.ts), through the shared writer
 * (plugins/project-files). Loaded only when the server writes, as lean's
 * writer is, so a dev server writes nothing.
 *
 * - A connection turned off, or undone (`history.undo`), is taken out at the
 *   next pass; unloading (the server shutting down, Ctrl+C or SIGTERM) takes
 *   everything out, so no folder keeps hooks to a server that isn't there.
 *   A hard kill runs no unload: the ledger mends it at the next start. What it added is kept
 *   in a ledger (config `ledger`), so a crash is mended at the next load.
 * - Only what it added is ever taken out: a person's own hooks, servers and
 *   lines, and what the lean writer keeps in the same settings file, stay.
 * - Git's exclude is found with git (`rev-parse --git-common-dir`, which a
 *   worktree shares); a folder outside a repository gets none.
 * - `connect-write.status`: folders and files written now. No paths.
 *
 * Config: `hook`, `mcp` (the adapter, as connect's), `ledger`, `home`.
 * Injects graph.read, graph.watch, action.register.
 */
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ActionRegister } from "../../spec/action.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import type { Entry } from "../project-files/entries.ts";
import { bringTo, loadLedger, safeFolder, saveLedger } from "../project-files/write.ts";
import { CHECKOUT, localCommand } from "./index.ts";
import { MCP, SETTINGS, TYPE, wanted } from "./here.ts";

export const STATUS = "connect-write.status";

export interface ConnectWriteConfig {
  hook?: string;
  mcp?: string;
  /** Where what it added is kept between loads. */
  ledger?: string;
  /** The home folder, never written in. */
  home?: string;
}

/** Git's exclude for a folder: in the repository's common folder, or none outside one. */
const excludeOf = (folder: string) =>
  new Promise<string | undefined>((ok) =>
    execFile("git", ["rev-parse", "--git-common-dir"], { cwd: folder, encoding: "utf8" }, (err, out) => ok(err ? undefined : join(resolve(folder, out.trim()), "info", "exclude"))),
  );

const connectWrite: Plugin<ConnectWriteConfig> = {
  id: "connect-write",
  about: "Writes each connected folder's Claude Code settings, and takes them out when it is disconnected.",
  inject: ["graph.read", "graph.watch", "action.register"],
  async apply(ctx: Context, config: ConnectWriteConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const home = config.home ?? homedir();
    const hook = config.hook ?? "http://127.0.0.1:5181/hook";
    const mcp = config.mcp ?? "http://127.0.0.1:5181/mcp";
    const report = (e: unknown) => ctx.runtime.report(ctx.fiber, e);
    const repo = JSON.parse(readFileSync(join(CHECKOUT, "plugins", "claude-code", "settings.json"), "utf8"));
    const want = wanted(repo, { hook, mcp, command: localCommand(hook) });
    const ledger = await loadLedger(config.ledger);
    let folders = 0;

    /** Per file, what is wanted of ours now. */
    const wantedNow = async (): Promise<Map<string, Entry[]>> => {
      const out = new Map<string, Entry[]>();
      folders = 0;
      for (let p = await graph.of(TYPE, { limit: LIMIT_MAX }); ; p = await graph.of(TYPE, { limit: LIMIT_MAX, after: p.next })) {
        for (const it of p.items) {
          const folder = it.fields.folder;
          if (it.fields.status !== "on" || typeof folder !== "string" || !(await safeFolder(folder, home))) continue;
          folders++;
          out.set(join(folder, SETTINGS), want.settings);
          out.set(join(folder, MCP), want.mcp);
          const exclude = await excludeOf(folder);
          if (exclude) out.set(exclude, [...(out.get(exclude) ?? []), ...want.exclude.filter((e) => !(out.get(exclude) ?? []).some((x) => JSON.stringify(x) === JSON.stringify(e)))]);
        }
        if (!p.next) break;
      }
      return out;
    };

    const pass = async (none = false) => {
      await bringTo(ledger, none ? new Map() : await wantedNow(), report, "connect");
      await saveLedger(config.ledger, ledger);
    };

    let queue: Promise<unknown> = Promise.resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let gone = false;
    const later = () => {
      if (gone) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        queue = queue.then(() => (gone ? undefined : pass())).catch(report);
      }, 50);
    };
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, later);
    later();
    ctx.effect(() => async () => {
      gone = true;
      clearTimeout(timer);
      await queue.catch(() => undefined);
      await pass(true).catch(report);
    });

    ctx.get<ActionRegister>("action.register").register({
      name: STATUS,
      title: "How many connected folders are written now",
      doc: "Folders and files written, no paths. Read only.",
      input: { type: "object", properties: {} },
      async run() {
        await queue.catch(() => undefined);
        return { folders, files: Object.keys(ledger).length };
      },
    });
  },
};

export default connectWrite;
