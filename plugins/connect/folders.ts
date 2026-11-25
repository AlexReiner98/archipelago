/**
 * The connect plugin's folders, server side: a folder whose Claude Code sessions
 * report to this map, from a terminal or the desktop app. Connecting is an
 * item on the map (a `connection`, here.ts) and every change to it an
 * action, so history shows who connected what, and `history.undo` takes it
 * back. Writing the folder's files is the writer's (write.ts), loaded only
 * when the server writes.
 *
 * - `connect.here` ({ folder? }): the folder's connection on (made the first
 *   time). No folder: this server's own checkout. Refused where the server
 *   writes no files (`npm run dev`): the terminal command, which writes
 *   nothing, is the way there.
 * - `connect.away` ({ folder? }): its connection off. The writer takes out
 *   what it added.
 * - `connect.folder` ({ folder? }): whether it is connected, and whether this
 *   server writes. Read only.
 *
 * Config (connect's): `writes` (as the server: false under `--no-write` or
 * with a host in front), `home` (never written in). Uses types.define,
 * graph.read, action.register, which connect injects.
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import type { ActionContext, ActionRegister } from "../../spec/action.ts";
import type { Fact } from "../../spec/changeset.ts";
import type { Id } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { GraphRead, Item } from "../../spec/graph.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { TypesDefine } from "../../spec/types.ts";
import type { Context } from "../../runtime/core.ts";
import { safeFolder } from "../project-files/write.ts";
import { CONNECTION, TYPE } from "./here.ts";
import { FOLDER } from "./setup.ts";

export const HERE = "connect.here";
export const AWAY = "connect.away";
export const FOLDER_STATE = "connect.folder";

export interface FoldersConfig {
  /** Whether the server writes files (a connection then reaches the folder's settings). Default true. */
  writes?: boolean;
  home?: string;
}

const refuse = (code: string, message: string) => new Refused({ code, message, by: { plugin: "connect" } });
const fold = (p: string) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
const folderInput = { type: "object", properties: { folder: { type: "string", description: "An absolute folder. Default: this server's own checkout." } } };

/** Defines the connection type and registers connect.here, connect.away and connect.folder; `checkout` is the folder when none is named. */
export function folders(ctx: Context, config: FoldersConfig, checkout: string): void {
  {
    const graph = ctx.get<GraphRead>("graph.read");
    const register = ctx.get<ActionRegister>("action.register");
    const writes = config.writes !== false;
    const home = config.home ?? homedir();
    ctx.get<TypesDefine>("types.define").base(CONNECTION);

    /** A folder's connection, if it has one. */
    const find = async (folder: string): Promise<Item | undefined> => {
      for (let p = await graph.of(TYPE, { limit: LIMIT_MAX }); ; p = await graph.of(TYPE, { limit: LIMIT_MAX, after: p.next })) {
        const it = p.items.find((i) => typeof i.fields.folder === "string" && fold(i.fields.folder) === fold(folder));
        if (it || !p.next) return it;
      }
    };
    const folderOf = async (input: { folder?: string }): Promise<string> => {
      const folder = resolve(input.folder ?? checkout);
      if (!(await safeFolder(folder, home))) throw refuse("connect.folder", `${folder} can't be connected: it must be a folder that is there, not the home folder or one above it, a drive's root, or under ~/.claude.`);
      return folder;
    };
    const status = (call: ActionContext, it: Item, to: "on" | "off") => {
      if (it.fields.status === to) return;
      const facts: Fact[] = [];
      if (it.fields.status !== undefined) facts.push(["-", it.id, "status", it.fields.status]);
      facts.push(["+", it.id, "status", to]);
      call.write(facts);
    };

    register.register({
      name: HERE,
      title: "Connect a folder's Claude Code sessions to this map",
      doc: "Its sessions then report here, from a terminal or the desktop app: the map's hooks and MCP server go into the folder's .claude/settings.local.json and .mcp.json, kept out of git. Start a new session there after. connect.away or history.undo takes it out.",
      input: folderInput,
      async run(input: { folder?: string }, call: ActionContext) {
        if (!writes) throw refuse("connect.no_write", `This server writes no files (npm run dev), so a folder can't be connected from here. Start one session that writes nothing instead, in the checkout: ${FOLDER}`);
        const folder = await folderOf(input);
        const had = await find(folder);
        if (had) {
          status(call, had, "on");
          return { connection: had.id, folder };
        }
        const id: Id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const name = folder.split(/[\\/]/).filter(Boolean).pop() ?? folder;
        call.write([
          ["+", id, "type", TYPE],
          ["+", id, "title", `Claude Code in ${name}`],
          ["+", id, "note", "Start a new Claude Code session in this folder, from a terminal or the desktop app: it reports here. Set it off, or undo this, to take the hooks and MCP server out again."],
          ["+", id, "folder", folder],
          ["+", id, "status", "on"],
        ]);
        return { connection: id, folder };
      },
    });

    register.register({
      name: AWAY,
      title: "Disconnect a folder's Claude Code sessions",
      doc: "Its connection off: what was added to its files is taken out. New sessions there no longer report.",
      input: folderInput,
      async run(input: { folder?: string }, call: ActionContext) {
        const folder = resolve(input.folder ?? checkout);
        const had = await find(folder);
        if (had) status(call, had, "off");
        return { folder, ...(had ? { connection: had.id } : {}) };
      },
    });

    register.register({
      name: FOLDER_STATE,
      title: "Whether a folder's sessions are connected",
      doc: "connected: its connection is on; writes: whether this server writes the files. Read only.",
      input: folderInput,
      async run(input: { folder?: string }) {
        const folder = resolve(input.folder ?? checkout);
        const had = await find(folder);
        return { folder, connected: had?.fields.status === "on", writes, ...(had ? { connection: had.id } : {}) };
      },
    });
  }
}
