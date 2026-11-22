/**
 * The Claude Code adapter. Claude Code's hooks and an MCP server become
 * callers of `agent.run`: what a hook or tool tells the model is what the
 * nodes say or refuse at a place, and what the agent does comes in as an act.
 * Nothing past this pack knows which harness is running.
 *
 * One HTTP server, the pack's effect (it closes when the pack unloads):
 * - `POST /hook`: Claude Code's http hooks post their input here and print
 *   the answer (see mapping.ts).
 * - `POST /mcp`: a streamable-HTTP MCP server (see mcp.ts), serving the
 *   tools packs add through `mcp.host`, which this pack provides. A client
 *   without hooks gets an `Mcp-Session-Id` on `initialize`, and its session
 *   is a run of its own (`mcp-<id>`, the client as agent); `DELETE /mcp`
 *   ends it.
 *
 * Each run (a Claude Code session) gets its own context, intercepted with the
 * agent as actor and the session id as run, so every call is the run's.
 */
import { randomUUID } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { Dispose } from "../../spec/common.ts";
import { Refused } from "../../spec/common.ts";
import type { McpHost, ToolDef, ToolResult, ToolRun } from "../mcp/host.ts";
import { HOST } from "../mcp/host.ts";
import type { AgentRun, AgentTree, Place } from "../../spec/agent.ts";
import type { Speakers } from "./context.ts";
import type { Actor, Json, Time } from "../../spec/common.ts";
import { META } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { refuse, type LocalAccess } from "../../runtime/guard.ts";
import { handle, lastAssistantText, refusalText, runIdOf, spoken, trim, type HookInput, type HookOutput, type Load, type RecordedCall, type RunPort } from "./mapping.ts";
import { rpc, type JsonRpc } from "./mcp.ts";

/** The places a run without hooks reaches: its start, and each tool call and result. */
export const MCP_REACHES = ["session_start", "tool:<name>", "tool_result:<name>"];

/** The agent an MCP client is, from the name it gives at `initialize`. */
export function clientActor(name: unknown): Actor {
  const id = String(typeof name === "string" && name ? name : "mcp-client").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(0, 60);
  return { id, kind: "agent" };
}

/**
 * `hosts` and `origins` add to what the runtime's guard answers: a request
 * with another Host, or with an Origin that is not the adapter's own or one
 * of these, is refused 403. Hooks and MCP clients send no Origin.
 */
export interface ClaudeCodeConfig extends LocalAccess {
  /** The port to listen on, on 127.0.0.1. 0 picks a free one. Default 5181. */
  port?: number;
  /** Who the agent is. Default `{ id: "claude-code", kind: "agent" }`. */
  agent?: Actor;
  /** The name the MCP server is added to Claude Code under: its tools are `mcp__<name>__<tool>`. Default `archipelago`. */
  name?: string;
  /** Told the port once listening (tests use port 0). */
  onListen?: (port: number) => void;
}

const BODY_MAX = 32 * 1024 * 1024;

function body(req: IncomingMessage): Promise<string> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > BODY_MAX) {
        fail(new Error("body too large"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => ok(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
}

function send(res: ServerResponse, status: number, value?: unknown): void {
  if (value === undefined) {
    res.writeHead(status).end();
    return;
  }
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
}

/** An MCP session of a client without hooks: a run of its own. */
interface Session {
  run: string;
  actor: Actor;
  client: string;
  state: RunState;
}

interface RunState extends RunPort {
  /** `action.invoke` from the run's context: the agent's `act` calls. */
  invoke: ActionInvoke;
  /** Hooks of one run are handled one at a time, in the order they came. */
  queue: Promise<unknown>;
}

async function transcript(input: HookInput): Promise<string | undefined> {
  if (!input.transcript_path) return undefined;
  try {
    return await readFile(input.transcript_path, "utf8");
  } catch {
    return undefined;
  }
}

/** The transcript from a byte offset, up to its last whole line. */
async function transcriptFrom(input: HookInput, offset: number): Promise<{ text: string; end: number } | undefined> {
  if (!input.transcript_path) return undefined;
  let file;
  try {
    file = await open(input.transcript_path, "r");
  } catch {
    return undefined;
  }
  try {
    const size = (await file.stat()).size;
    if (size <= offset) return { text: "", end: size < offset ? 0 : offset };
    const buf = Buffer.alloc(size - offset);
    const { bytesRead } = await file.read(buf, 0, buf.length, offset);
    const whole = buf.subarray(0, bytesRead).lastIndexOf(10) + 1;
    return { text: buf.subarray(0, whole).toString("utf8"), end: offset + whole };
  } finally {
    await file.close();
  }
}

async function lastReply(input: HookInput): Promise<string | undefined> {
  const text = await transcript(input);
  return text === undefined ? undefined : lastAssistantText(text);
}

const claudeCode: Pack<ClaudeCodeConfig> = {
  id: "claude-code",
  about: "Connects Claude Code: its sessions report here and hear what the map says.",
  inject: ["agent.run", "agent.tree", "action.invoke", "action.list", "exchange.read"],
  async apply(ctx: Context, config: ClaudeCodeConfig = {}) {
    const actor: Actor = config.agent ?? { id: "claude-code", kind: "agent" };
    const actions = ctx.get<ActionList>("action.list");
    const read = ctx.get<ExchangeRead>("exchange.read");
    const tree = ctx.get<AgentTree>("agent.tree");
    /** Who a node is, as loaded now: its title tags its words, its kind orders session_start. */
    const speakers: Speakers = (id) => {
      const n = tree.nodes().find((x) => x.id === id);
      return n && { title: n.title, kind: n.kind };
    };
    /** The run's tool acts on the record, from `since` on. */
    const recorded = async (run: string, since?: Time): Promise<RecordedCall[]> => {
      const out: RecordedCall[] = [];
      for (let p = await read.events(run, { limit: LIMIT_MAX }); ; p = await read.events(run, { limit: LIMIT_MAX, after: p.next })) {
        for (const e of p.items) {
          if (e.kind !== "act" || e.act?.kind !== "tool" || !e.place || (since && e.time < since)) continue;
          out.push({ place: e.place, ...(e.act.input !== undefined ? { input: e.act.input } : {}) });
        }
        if (!p.next) return out;
      }
    };
    /** How many times each skill:/memory: place was reached in the run: one count per moment said there. */
    const loadedSaid = async (run: string): Promise<Map<Place, number>> => {
      const moments = new Map<Place, Set<string>>();
      for (let p = await read.events(run, { limit: LIMIT_MAX }); ; p = await read.events(run, { limit: LIMIT_MAX, after: p.next })) {
        for (const e of p.items) {
          if (e.kind !== "say" || !e.place || !/^(skill|memory):/.test(e.place)) continue;
          const set = moments.get(e.place) ?? new Set();
          set.add(e.time);
          moments.set(e.place, set);
        }
        if (!p.next) return new Map([...moments].map(([place, s]) => [place, s.size]));
      }
    };
    const home = homedir();
    const prefix = `mcp__${config.name ?? "archipelago"}__`;
    /** The tools packs added through `mcp.host`, in the order they came. */
    const tools = new Map<string, ToolDef>();
    const runs = new Map<string, RunState>();
    /** Calls of this server's tools, by tool use id, to the run that was about to make them. */
    const hearing = new Map<string, string>();
    let lastHearing: string | undefined;

    const runOf = (session: string): RunState => {
      let state = runs.get(session);
      if (!state) {
        const runCtx = ctx.intercept({ [META.actor]: actor, [META.run]: session });
        state = { agent: runCtx.get<AgentRun>("agent.run"), invoke: runCtx.get<ActionInvoke>("action.invoke"), begun: false, seen: new Set(), queue: Promise.resolve() };
        runs.set(session, state);
      }
      return state;
    };

    const hook = (input: HookInput): Promise<HookOutput> => {
      const key = runIdOf(input);
      const state = runOf(key);
      if (input.hook_event_name === "PreToolUse" && input.tool_name?.startsWith(prefix)) {
        if (input.tool_use_id) hearing.set(input.tool_use_id, key);
        lastHearing = key;
      }
      const next = state.queue.then(() => handle(input, state, {
        actor,
        lastReply,
        transcript,
        recorded,
        transcriptFrom,
        loadedSaid,
        home,
        speakers,
        // A node to say the load, when a pack declares `loaded.note`; nothing is lost when none does.
        note: async (l: Load) => {
          if (!actions.list().some((a) => a.name === "loaded.note")) return;
          await state.invoke.invoke({
            action: "loaded.note",
            input: { place: l.place, kind: l.kind, title: l.title, ...(l.path ? { path: l.path } : {}) },
            authority: { of: "agent", basis: "Claude Code loaded it into the run" },
            reason: `Claude Code loaded ${l.title}`,
          });
        },
      }));
      state.queue = next.catch(() => {});
      if (input.hook_event_name === "SubagentStop") void next.finally(() => !state.begun && runs.delete(key));
      if (input.hook_event_name === "SessionEnd") {
        void next.finally(() => runs.delete(key));
        // A subagent still open when its session ends ends with it.
        for (const [k, child] of runs) {
          if (!k.startsWith(`${input.session_id}:`)) continue;
          runs.delete(k);
          child.queue = child.queue.then(async () => {
            if (child.begun) await child.agent.end(k, new Date().toISOString());
          }).catch(() => {});
        }
      }
      return next;
    };

    const sessions = new Map<string, Session>();
    const now = () => new Date().toISOString();
    /** A call from a session's client: the adapter reaches and records what the hooks would. */
    const sessionCall = (s: Session, tool: ToolDef, args: { [key: string]: Json }, run: ToolRun): Promise<ToolResult> => {
      const st = s.state;
      const next = st.queue.then(async (): Promise<ToolResult> => {
        const said: (string | undefined)[] = [];
        if (!st.begun) {
          await st.agent.begin({ run: s.run, agent: s.actor, harness: s.client, reaches: MCP_REACHES, title: s.client });
          st.begun = true;
          said.push(spoken(await st.agent.reach({ run: s.run, places: ["session_start"], time: now() }), speakers, ["session_start"]));
        }
        const place = `tool:${prefix}${tool.name}`;
        const input = trim(args) ?? null;
        const before = await st.agent.reach({ run: s.run, places: [place], time: now(), input });
        if (before.refused) {
          const { node, text, code } = before.refused;
          await st.agent.act({ run: s.run, place, time: now(), kind: "tool", by: "agent", input, output: { refused: node, text, ...(code ? { code } : {}) }, ok: false });
          return { text: [refusalText(before, speakers), ...said].filter(Boolean).join("\n\n"), isError: true };
        }
        said.push(spoken(before, speakers));
        let out: ToolResult;
        try {
          out = await tool.call(args, run);
        } catch (err) {
          out = { text: `${tool.name} failed: ${(err as Error)?.message ?? String(err)}`, isError: true };
        }
        await st.agent.act({ run: s.run, place, time: now(), kind: "tool", by: "agent", input, output: trim(out.text) ?? null, ok: !out.isError });
        said.push(spoken(await st.agent.reach({ run: s.run, places: [`tool_result:${prefix}${tool.name}`], time: now(), input: trim(out.text) ?? null }), speakers));
        const words = said.filter(Boolean);
        return words.length ? { ...out, text: `${out.text}\n\n${words.join("\n\n")}` } : out;
      });
      st.queue = next.catch(() => {});
      return next;
    };
    /** A client without hooks opens a session at `initialize`; Claude Code's calls are found through its hooks. */
    const sessionOf = (msg: JsonRpc): string | undefined => {
      if (msg.method !== "initialize") return undefined;
      const client = msg.params?.clientInfo?.name;
      if (client === "claude-code") return undefined;
      const id = randomUUID();
      const agent = clientActor(client);
      const run = `mcp-${id}`;
      const runCtx = ctx.intercept({ [META.actor]: agent, [META.run]: run });
      const state: RunState = { agent: runCtx.get<AgentRun>("agent.run"), invoke: runCtx.get<ActionInvoke>("action.invoke"), begun: false, seen: new Set(), queue: Promise.resolve() };
      sessions.set(id, { run, actor: agent, client: agent.id, state });
      return id;
    };
    const endSession = async (id: string) => {
      const s = sessions.get(id);
      sessions.delete(id);
      if (!s) return;
      s.state.queue = s.state.queue.then(async () => {
        if (s.state.begun) await s.state.agent.end(s.run, now());
      }).catch(() => {});
      await s.state.queue;
    };
    ctx.effect(() => () => void sessions.clear());

    const sessionMcp = (msg: JsonRpc, s: Session) => {
      const run: ToolRun = { run: s.run, actor: s.actor, agent: s.state.agent, invoke: s.state.invoke };
      return rpc(msg, { runFor: () => run, tools: () => [...tools.values()], call: (tool, args, r) => sessionCall(s, tool, args, r ?? run) });
    };

    const mcp = (msg: JsonRpc) =>
      rpc(msg, {
        runFor(toolUseId) {
          const session = (toolUseId && hearing.get(toolUseId)) || lastHearing;
          if (toolUseId) hearing.delete(toolUseId);
          if (!session) return undefined;
          const state = runOf(session);
          return { run: session, actor, agent: state.agent, invoke: state.invoke };
        },
        tools: () => [...tools.values()],
      });

    ctx.provide<McpHost>(HOST, (_caller, from) => ({
      harness: "claude-code",
      place: (tool) => `tool:${prefix}${tool}`,
      add(def): Dispose {
        if (tools.has(def.name)) {
          throw new Refused({ code: "mcp.tool_taken", message: `A tool ${def.name} is already served.`, by: { pack: "claude-code" } });
        }
        return from.effect(() => {
          tools.set(def.name, def);
          return () => tools.delete(def.name);
        });
      },
    }));

    const server: Server = createServer(async (req, res) => {
      if (refuse(req, res, config)) return;
      const path = (req.url ?? "/").split("?")[0];
      try {
        if (req.method === "POST" && path === "/hook") {
          const input = JSON.parse(await body(req)) as HookInput;
          if (typeof input?.session_id !== "string" || typeof input.hook_event_name !== "string") {
            return send(res, 400, { error: "a hook input needs session_id and hook_event_name" });
          }
          return send(res, 200, await hook(input));
        }
        if (path === "/mcp") {
          const header = req.headers["mcp-session-id"];
          const id = typeof header === "string" ? header : undefined;
          const session = id ? sessions.get(id) : undefined;
          // A session this server doesn't know (it restarted): the client starts a new one.
          if (id && !session) return send(res, 404, { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Session not found" } });
          if (req.method === "DELETE" && id) {
            await endSession(id);
            return send(res, 204);
          }
          if (req.method !== "POST") return send(res, 405);
          const parsed = JSON.parse(await body(req)) as JsonRpc | JsonRpc[];
          const answer = (m: JsonRpc) => (session ? sessionMcp(m, session) : mcp(m));
          if (Array.isArray(parsed)) {
            const out = (await Promise.all(parsed.map(answer))).filter(Boolean);
            return out.length ? send(res, 200, out) : send(res, 202);
          }
          const opened = session ? undefined : sessionOf(parsed);
          if (opened) res.setHeader("mcp-session-id", opened);
          const out = await answer(parsed);
          return out ? send(res, 200, out) : send(res, 202);
        }
        if (req.method === "GET" && path === "/health") return send(res, 200, { ok: true, runs: runs.size });
        send(res, 404);
      } catch (err) {
        ctx.runtime.report(ctx.fiber, err);
        // A hook that fails must not stop the agent: answer nothing to say.
        if (!res.headersSent) send(res, path === "/hook" ? 200 : 500, path === "/hook" ? {} : { error: String(err) });
      }
    });

    ctx.effect(
      () => () =>
        new Promise<void>((done) => {
          if (!server.listening) return done();
          server.close(() => done());
          server.closeAllConnections();
        }),
    );
    await new Promise<void>((ok, fail) => {
      server.once("error", fail);
      server.listen(config.port ?? 5181, "127.0.0.1", () => {
        server.off("error", fail);
        const address = server.address();
        if (address && typeof address === "object") config.onListen?.(address.port);
        ok();
      });
    });
  },
};

export default claudeCode;
