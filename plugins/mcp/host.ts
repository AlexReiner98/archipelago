/**
 * `mcp.host`: an MCP server a harness adapter runs, which other plugins add
 * tools to. The adapter provides it (Claude Code's serves `/mcp` beside its
 * hooks) and knows the harness: what a tool is called there, and which run
 * a call belongs to. A tool knows neither: it gets the run, if one is known.
 *
 * A plugin-own key, like `verdict.read`: the mcp plugin and the adapters agree
 * on it here. A candidate for the spec once a second adapter provides it.
 */
import type { ActionInvoke } from "../../spec/action.ts";
import type { AgentRun, Place, RunId } from "../../spec/agent.ts";
import type { Actor, Dispose, Json } from "../../spec/common.ts";

export const HOST = "mcp.host";

/** The run a tool call belongs to, with the run's own `agent.run` and `action.invoke`. */
export interface ToolRun {
  run: RunId;
  actor: Actor;
  agent: AgentRun;
  invoke: ActionInvoke;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export interface ToolDef {
  /** Short, unique on the host: `get`. */
  name: string;
  /** Said to the agent in the tool list; read each time the list is asked for. */
  description(): string | Promise<string>;
  inputSchema: { [key: string]: Json };
  /** `run` is absent when the host can't tell whose call it is. */
  call(args: { [key: string]: Json }, run: ToolRun | undefined): Promise<ToolResult>;
}

export interface McpHost {
  /** Which harness serves it: `claude-code`. */
  harness: string;
  /** The place where the agent is about to call a tool of this host: `tool:mcp__archipelago__get`. */
  place(tool: string): Place;
  /** Serves a tool, as the calling plugin's; a taken name is refused. */
  add(def: ToolDef): Dispose;
}
