/**
 * The adapter's MCP server: JSON-RPC over streamable HTTP, answered with
 * JSON. Its one tool, `hear`, is a caller of `agent.run` like the hooks:
 * what it tells the model is only what the nodes say at the place asked.
 *
 * A tool call doesn't name its session, so the adapter finds the run from
 * the tool use id its PreToolUse hook saw (`_meta["claudecode/toolUseId"]`),
 * else the last run that was about to call it.
 */
import type { AgentRun, Answer, Place } from "../../spec/agent.ts";
import { PLACES } from "../../spec/agent.ts";
import type { Json, Time } from "../../spec/common.ts";

export const SERVER = { name: "archipelago", version: "0.1.0" };
export const PROTOCOL = "2025-06-18";
export const HEAR = "hear";

export const TOOLS = [
  {
    name: HEAR,
    description:
      "What the map says at a place in this run, before you get there: `file:<path>` for a file, `tool:<name>` for a tool. " +
      "Places are the agent spec's: session_start, prompt, tool:<name>, file:<path>, tool_result:<name>, reply_end.",
    inputSchema: {
      type: "object",
      properties: { place: { type: "string", description: "A place, such as file:spec/agent.ts or tool:Bash." } },
      required: ["place"],
    },
  },
];

const FAMILIES = PLACES.map((p) => p.term.replace(/<.*>$/, ""));

/** Whether a place is one of the spec's, with an argument where its family takes one. */
export function knownPlace(place: string): boolean {
  return FAMILIES.some((f) => (f.endsWith(":") ? place.startsWith(f) && place.length > f.length : place === f));
}

export interface JsonRpc {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: any;
}

export interface McpPorts {
  /** The run a tool call belongs to: `agent.run` from its context, or nothing if no run is known. */
  runFor(toolUseId: string | undefined): { run: string; agent: AgentRun } | undefined;
  now?: () => Time;
}

const result = (id: JsonRpc["id"], value: Json) => ({ jsonrpc: "2.0", id: id ?? null, result: value });
const failure = (id: JsonRpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (t: string, isError = false): Json => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

export function hearText(answer: Answer): { text: string; isError: boolean } {
  const said = answer.said.map((s) => s.text).join("\n\n");
  if (answer.refused) return { text: said ? `${answer.refused.text}\n\n${said}` : answer.refused.text, isError: true };
  return { text: said || "Nothing is said here.", isError: false };
}

/** Answers one JSON-RPC message; a notification answers nothing. */
export async function rpc(msg: JsonRpc, ports: McpPorts): Promise<object | undefined> {
  const now = ports.now ?? (() => new Date().toISOString());
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
    case "tools/list":
      return result(msg.id, { tools: TOOLS as unknown as Json });
    case "tools/call": {
      const name = msg.params?.name;
      if (name !== HEAR) return failure(msg.id, -32602, `No tool ${String(name)}.`);
      const place = msg.params?.arguments?.place;
      if (typeof place !== "string" || !knownPlace(place)) {
        return result(msg.id, text(`Not a place: ${String(place)}. Use file:<path>, tool:<name>, or another place of the agent spec.`, true));
      }
      const port = ports.runFor(msg.params?._meta?.["claudecode/toolUseId"]);
      if (!port) return result(msg.id, text("No run is known here yet: hooks haven't reached the adapter.", true));
      const answer = await port.agent.reach({ run: port.run, places: [place as Place], time: now() });
      const t = hearText(answer);
      return result(msg.id, text(t.text, t.isError));
    }
    default:
      return failure(msg.id, -32601, `No method ${String(msg.method)}.`);
  }
}
