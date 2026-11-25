/**
 * The adapter's MCP server: JSON-RPC over streamable HTTP, answered with
 * JSON. It serves whatever tools plugins add through `mcp.host` (the mcp
 * plugin's: hear, act, get, query, tell, run) and knows none of them: it
 * lists them, and hands each call its run.
 *
 * A tool call doesn't name its session, so the adapter finds the run from
 * the tool use id its PreToolUse hook saw (`_meta["claudecode/toolUseId"]`),
 * else the last run that was about to call one of this server's tools.
 *
 * A client without hooks (anything but Claude Code: claude.ai, a desktop
 * chat) gets an MCP session on `initialize`, and each session is a run of
 * its own: the adapter hands its calls to `ports.call`, which reaches the
 * tool's places and records the call, as the hooks would.
 */
import type { Json } from "../../spec/common.ts";
import type { ToolDef, ToolResult, ToolRun } from "../mcp/host.ts";

export const SERVER = { name: "archipelago", version: "0.2.0" };
export const PROTOCOL = "2025-06-18";

export interface JsonRpc {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: any;
}

export interface McpPorts {
  /** The tools served now, in the order they were added. */
  tools(): ToolDef[];
  /** The run a tool call belongs to, or nothing if no run is known. */
  runFor(toolUseId: string | undefined): ToolRun | undefined;
  /** Makes the call itself, when the adapter records it (a client without hooks); absent, `tool.call`. */
  call?(tool: ToolDef, args: { [key: string]: Json }, run: ToolRun | undefined): Promise<ToolResult>;
  /** What `initialize` tells the client to keep in mind (MCP's `instructions`). */
  instructions?: string;
}

const result = (id: JsonRpc["id"], value: Json) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: JsonRpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (t: string, isError = false): Json => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** Answers one JSON-RPC message; a notification answers nothing. */
export async function rpc(msg: JsonRpc, ports: McpPorts): Promise<object | undefined> {
  if (msg.id === undefined) return undefined;
  switch (msg.method) {
    case "initialize":
      return result(msg.id, {
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: SERVER,
        ...(ports.instructions ? { instructions: ports.instructions } : {}),
      });
    case "ping":
      return result(msg.id, {});
    case "tools/list": {
      const tools = await Promise.all(
        ports.tools().map(async (t) => ({ name: t.name, description: await t.description(), inputSchema: t.inputSchema })),
      );
      return result(msg.id, { tools: tools as unknown as Json });
    }
    case "tools/call": {
      const name = msg.params?.name;
      const tool = ports.tools().find((t) => t.name === name);
      if (!tool) return failure(msg.id, -32602, `No tool ${String(name)}.`);
      const raw = msg.params?.arguments;
      const args = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as { [key: string]: Json }) : {};
      try {
        const run = ports.runFor(msg.params?._meta?.["claudecode/toolUseId"]);
        const out = ports.call ? await ports.call(tool, args, run) : await tool.call(args, run);
        return result(msg.id, text(out.text, out.isError));
      } catch (err) {
        return result(msg.id, text(`${tool.name} failed: ${(err as Error)?.message ?? String(err)}`, true));
      }
    }
    default:
      return failure(msg.id, -32601, `No method ${String(msg.method)}.`);
  }
}
