/**
 * The Claude Code adapter. Claude Code's hooks and an MCP server become
 * callers of `agent.run`: what a hook or tool tells the model is what the
 * nodes say or refuse at a place, and what the agent does comes in as an act.
 * Nothing past this pack knows which harness is running.
 *
 * One HTTP server, the pack's effect (it closes when the pack unloads):
 * - `POST /hook`: Claude Code's http hooks post their input here and print
 *   the answer (see mapping.ts).
 * - `POST /mcp`: a streamable-HTTP MCP server (see mcp.ts): `hear` and `act`.
 *
 * Each run (a Claude Code session) gets its own context, intercepted with the
 * agent as actor and the session id as run, so every call is the run's.
 */
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ActionInvoke, ActionList } from "../../spec/action.ts";
import type { AgentRun } from "../../spec/agent.ts";
import type { Actor, Time } from "../../spec/common.ts";
import { META } from "../../spec/common.ts";
import type { ExchangeRead } from "../../spec/exchange.ts";
import { LIMIT_MAX } from "../../spec/graph.ts";
import type { Context, Pack } from "../../runtime/core.ts";
import { handle, lastAssistantText, type HookInput, type HookOutput, type RecordedCall, type RunPort } from "./mapping.ts";
import { TOOL_NAMES, rpc, type JsonRpc } from "./mcp.ts";

export interface ClaudeCodeConfig {
  /** The port to listen on, on 127.0.0.1. 0 picks a free one. Default 5181. */
  port?: number;
  /** Who the agent is. Default `{ id: "claude-code", kind: "agent" }`. */
  agent?: Actor;
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

async function lastReply(input: HookInput): Promise<string | undefined> {
  const text = await transcript(input);
  return text === undefined ? undefined : lastAssistantText(text);
}

const claudeCode: Pack<ClaudeCodeConfig> = {
  id: "claude-code",
  inject: ["agent.run", "action.invoke", "action.list", "exchange.read"],
  async apply(ctx: Context, config: ClaudeCodeConfig = {}) {
    const actor: Actor = config.agent ?? { id: "claude-code", kind: "agent" };
    const actions = ctx.get<ActionList>("action.list");
    const read = ctx.get<ExchangeRead>("exchange.read");
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
    const runs = new Map<string, RunState>();
    /** MCP calls of `hear`, by tool use id, to the run that was about to make them. */
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
      const state = runOf(input.session_id);
      if (input.hook_event_name === "PreToolUse" && input.tool_name?.startsWith("mcp__") && TOOL_NAMES.some((n) => input.tool_name!.endsWith(`__${n}`))) {
        if (input.tool_use_id) hearing.set(input.tool_use_id, input.session_id);
        lastHearing = input.session_id;
      }
      const next = state.queue.then(() => handle(input, state, { actor, lastReply, transcript, recorded }));
      state.queue = next.catch(() => {});
      if (input.hook_event_name === "SessionEnd") void next.finally(() => runs.delete(input.session_id));
      return next;
    };

    const mcp = (msg: JsonRpc) =>
      rpc(msg, {
        runFor(toolUseId) {
          const session = (toolUseId && hearing.get(toolUseId)) || lastHearing;
          if (toolUseId) hearing.delete(toolUseId);
          if (!session) return undefined;
          const state = runOf(session);
          return { run: session, agent: state.agent, invoke: state.invoke };
        },
        actions: () => actions.list(),
      });

    const server: Server = createServer(async (req, res) => {
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
          if (req.method !== "POST") return send(res, 405);
          const parsed = JSON.parse(await body(req)) as JsonRpc | JsonRpc[];
          if (Array.isArray(parsed)) {
            const out = (await Promise.all(parsed.map(mcp))).filter(Boolean);
            return out.length ? send(res, 200, out) : send(res, 202);
          }
          const out = await mcp(parsed);
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
