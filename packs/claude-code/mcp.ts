/**
 * The adapter's MCP server: JSON-RPC over streamable HTTP, answered with
 * JSON. It serves whatever tools packs add through `mcp.host` (the mcp
 * pack's: hear, act, get, query, tell, run) and knows none of them: it
 * lists them, and hands each call its run.
 *
 * A tool call doesn't name its session, so the adapter finds the run from
 * the tool use id its PreToolUse hook saw (`_meta["claudecode/toolUseId"]`),
 * else the last run that was about to call one of this server's tools.
 */
import type { Json } from "../../spec/common.ts";
import type { ToolDef, ToolRun } from "../mcp/host.ts";

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
        const out = await tool.call(args, ports.runFor(msg.params?._meta?.["claudecode/toolUseId"]));
        return result(msg.id, text(out.text, out.isError));
      } catch (err) {
        return result(msg.id, text(`${tool.name} failed: ${(err as Error)?.message ?? String(err)}`, true));
      }
    }
    default:
      return failure(msg.id, -32601, `No method ${String(msg.method)}.`);
  }
}
