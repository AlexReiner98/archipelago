/**
 * The lean writer: what a profile that is on leaves out (its `leave_out`,
 * set by `lean.set`), written into the settings Claude Code reads in its
 * runs' project folders. Loaded only when the server writes (as the written
 * plugin is), so a dev server writes nothing.
 *
 * - Where: `<cwd>/.claude/settings.local.json` of the newest runs (WINDOW,
 *   pages of LIMIT_MAX), never anywhere else: not the home folder, not a
 *   drive's root, nothing under `~/.claude`, and never the user's own
 *   settings.
 * - What: a tool left out is a `permissions.deny` rule with its name; a
 *   server, `mcp__<server>` (all its tools) and, in
 *   `disabledMcpjsonServers`, its name, so a project's server doesn't start.
 * - A folder shared by runs of several profiles gets only what every one of
 *   them leaves out: a run in a profile that leaves nothing out, or in none,
 *   keeps everything there.
 * - Only what it added is ever taken out (plan.ts `reconcile`); an entry the
 *   file had stays. A file it made goes when nothing else is in it.
 * - Revertible: undoing the `lean.set` change set, or the profile going off,
 *   takes its entries out at the next pass; unloading takes them all out.
 *   What it added is kept in a ledger (config `ledger`, a file in the data
 *   folder), so a crash is mended at the next load.
 * - `lean-write.status`: how many files and entries are written now. No paths.
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ActionRegister } from "../../spec/action.ts";
import type { RunInfo } from "../../spec/agent.ts";
import type { Id } from "../../spec/common.ts";
import type { ExchangeRead, ExchangeWatch } from "../../spec/exchange.ts";
import type { GraphRead, GraphWatch } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { ProfileRead } from "../../spec/profile.ts";
import type { Context, Plugin } from "../../runtime/core.ts";
import { setOf, TYPE } from "./index.ts";
import { entriesOf, kept, leanEntries } from "./plan.ts";
import type { Entry } from "../project-files/entries.ts";
import { bringTo, loadLedger, safeFolder, saveLedger } from "../project-files/write.ts";

export { safeFolder };

export const STATUS = "lean-write.status";
/** The newest runs whose folders are written. */
export const WINDOW = 50;
export const RUN_PAGES = 20;
/** The file Claude Code reads in a project, kept out of git by Claude Code's own ignore. */
export const SETTINGS = join(".claude", "settings.local.json");

export interface LeanWriteConfig {
  /** Where what it added is kept between loads. */
  ledger?: string;
  /** The home folder, never written in. */
  home?: string;
}

const fold = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));

const cwdOf = (r: RunInfo) => {
  const c = r.facts?.cwd ?? r.cwd;
  const v = Array.isArray(c) ? c[0] : c;
  return typeof v === "string" && v ? v : undefined;
};

const leanWrite: Plugin<LeanWriteConfig> = {
  id: "lean-write",
  about: "Writes what an on profile leaves out of Claude Code's context into its runs' project settings.",
  inject: ["graph.read", "graph.watch", "exchange.read", "exchange.watch", "profile.read", "action.register"],
  async apply(ctx: Context, config: LeanWriteConfig = {}) {
    const graph = ctx.get<GraphRead>("graph.read");
    const exchange = ctx.get<ExchangeRead>("exchange.read");
    const profiles = ctx.get<ProfileRead>("profile.read");
    const home = config.home ?? homedir();
    const report = (e: unknown) => ctx.runtime.report(ctx.fiber, e);
    const ledger = await loadLedger(config.ledger);
    // A ledger an older lean wrote ({ deny, servers }): said as the shared writer's entries.
    for (const [file, o] of Object.entries(ledger) as [string, any][]) {
      if (!Array.isArray(o.entries)) ledger[file] = { entries: leanEntries({ deny: o.deny ?? [], servers: o.servers ?? [] }), ...(o.created ? { created: true } : {}), ...(o.dir ? { dir: true } : {}) };
    }

    /** Per settings file, what is wanted of ours now. */
    const wanted = async (): Promise<Map<string, { folder: string; deny: string[]; servers: string[] }>> => {
      const lean = new Map<Id, string[]>();
      for (const it of (await graph.of(TYPE, { limit: LIMIT_MAX })).items) {
        const names = setOf(it).filter((n) => !kept(n));
        if (it.fields.status === "on" && names.length) lean.set(it.id, names);
      }
      const byFolder = new Map<string, { folder: string; names: Set<string> | undefined }>();
      let after: string | undefined;
      let seen = 0;
      for (let p = 0; p < RUN_PAGES && seen < WINDOW; p++) {
        const page = await exchange.runs({ limit: LIMIT_MAX, ...(after ? { after } : {}) });
        for (const r of page.items) {
          const cwd = cwdOf(r);
          if (!cwd || seen >= WINDOW) continue;
          seen++;
          const mine = new Set<string>();
          for (const q of await profiles.of(r)) for (const n of lean.get(q.id) ?? []) mine.add(n);
          const key = fold(cwd);
          const had = byFolder.get(key);
          // What every run there leaves out.
          byFolder.set(key, { folder: had?.folder ?? resolve(cwd), names: had?.names ? new Set([...had.names].filter((n) => mine.has(n))) : mine });
        }
        if (!page.next) break;
        after = page.next;
      }
      const out = new Map<string, { folder: string; deny: string[]; servers: string[] }>();
      for (const { folder, names } of byFolder.values()) {
        if (!names?.size || !(await safeFolder(folder, home))) continue;
        const e = [...names].sort().map(entriesOf);
        out.set(join(folder, SETTINGS), { folder, deny: e.map((x) => x.deny), servers: e.flatMap((x) => (x.server ? [x.server] : [])) });
      }
      return out;
    };

    /** Brings every file to what is wanted (nothing, when `none`): the shared writer (plugins/project-files). */
    const pass = async (none = false) => {
      const want = new Map<string, Entry[]>();
      if (!none) for (const [file, w] of await wanted()) want.set(file, leanEntries(w));
      await bringTo(ledger, want, report, "lean");
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
      }, 100);
    };
    ctx.get<GraphWatch>("graph.watch").watch({ types: [TYPE] }, later);
    ctx.get<ExchangeWatch>("exchange.watch").watch({ kinds: ["begin"] }, later);
    profiles.watch(later);
    later();
    ctx.effect(() => async () => {
      gone = true;
      clearTimeout(timer);
      await queue.catch(() => undefined);
      await pass(true).catch(report);
    });

    ctx.get<ActionRegister>("action.register").register({
      name: STATUS,
      title: "How much of what profiles leave out is written into project settings now",
      doc: "Files and entries written, no paths. Read only.",
      input: { type: "object", properties: {} },
      async run() {
        await queue.catch(() => undefined);
        const all = Object.values(ledger);
        return { files: all.length, entries: all.reduce((n, e) => n + e.entries.length, 0) };
      },
    });
  },
};

export default leanWrite;
