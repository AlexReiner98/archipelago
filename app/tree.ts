/**
 * The server's config tree and the words it seeds: what app/server.ts runs.
 * Kept apart from the server so a host can start from it (`serverTree`) and
 * add its own plugins, through the same loader.
 */
import { join } from "node:path";
import type { Entry } from "../runtime/loader.ts";
import { localOrigins } from "../runtime/guard.ts";
import type { OtelConfig } from "../plugins/otel/index.ts";

/**
 * What a fresh map says before anyone has written a node: only what fits
 * any repository a run is in. This repository's own rules (the spec, tests,
 * docs, bounded reads, the check) are in its CLAUDE.md, which reaches the
 * people and agents who work on it; a seed would say them in everyone's.
 */
export const SEED = [
  {
    title: "Says the run is recorded",
    kind: "instruction",
    at: ["session_start"],
    words: "This run is recorded on the exchange: every say, refusal and act shows live in the context interface.",
  },
  {
    title: "No secrets",
    kind: "rule",
    at: ["file:.env", "file:**/.env"],
    words: "The map refuses .env files: they hold secrets.",
    refuse: true,
  },
];


export interface TreeOptions {
  /** Where the plugins keep their data. */
  data: string;
  /** The page's port: the adapter listens one above it, the bridge two. */
  port: number;
  /** Whether the written plugin writes skill and memory files. */
  write: boolean;
  /** More origins the page, the adapter and the bridge answer, besides the page's own (a host in front of them). */
  origins?: string[];
  /** More Host values they answer (a proxy in front that keeps its own). */
  hosts?: string[];
  /** Where the otel plugin sends the exchange as spans (plugins/otel). Absent: it sends nothing. */
  otel?: OtelConfig;
}

/**
 * The otel plugin's config from the environment: the standard
 * `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` or `OTEL_EXPORTER_OTLP_ENDPOINT`, its
 * `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k=v`) and `OTEL_SERVICE_NAME`; the words
 * go only with `ARCHIPELAGO_OTEL_CONTENT=1`.
 */
export function otelFromEnv(env: Record<string, string | undefined>): OtelConfig {
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT || env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (!endpoint) return {};
  const headers: Record<string, string> = {};
  for (const part of (env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    const i = part.indexOf("=");
    if (i > 0) headers[decodeURIComponent(part.slice(0, i).trim())] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return {
    endpoint,
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(env.OTEL_SERVICE_NAME ? { service: env.OTEL_SERVICE_NAME } : {}),
    include_content: env.ARCHIPELAGO_OTEL_CONTENT === "1",
  };
}

/** What the page server is given, so that it answers the same as the adapter and the bridge. */
export function pageAccess({ port: PAGE, origins = [], hosts = [] }: Pick<TreeOptions, "port" | "origins" | "hosts">) {
  return { origins: [...localOrigins(PAGE), ...origins], hosts };
}

/**
 * The server's config tree. A host that runs the server its own way (more
 * plugins, another front) starts from this tree and adds to it.
 */
export function serverTree({ data, port: PAGE, write, origins = [], hosts = [], otel = {} }: TreeOptions): Entry[] {
  // The app's own origin is the page's: the adapter and the bridge answer it, and a host's in front.
  const access = pageAccess({ port: PAGE, origins, hosts });
  return [
    { id: "graph", plugin: "plugins/graph/index.ts", config: { db: join(data, "graph.sqlite") } },
    { id: "action", plugin: "plugins/action/index.ts" },
    { id: "types", plugin: "plugins/types/index.ts" },
    { id: "work", plugin: "plugins/work/index.ts" },
    { id: "question", plugin: "plugins/question/index.ts" },
    { id: "record", plugin: "plugins/record/index.ts" },
    { id: "actor", plugin: "plugins/actor/index.ts" },
    { id: "links", plugin: "plugins/links/index.ts" },
    { id: "branch", plugin: "plugins/branch/index.ts" },
    { id: "items", plugin: "plugins/items/index.ts" },
    { id: "page", plugin: "plugins/page/index.ts" },
    { id: "views", plugin: "plugins/views/index.ts" },
    { id: "switch", plugin: "plugins/switch/server.ts" },
    { id: "schema", plugin: "plugins/schema/index.ts", config: { db: join(data, "schema.sqlite") } },
    { id: "history", plugin: "plugins/history/index.ts", config: { db: join(data, "history.sqlite") } },
    { id: "interchange", plugin: "plugins/interchange/index.ts" },
    { id: "exchange", plugin: "plugins/exchange/index.ts", config: { journal: join(data, "exchange.jsonl") } },
    { id: "agent", plugin: "plugins/agent/index.ts" },
    { id: "git", plugin: "plugins/git/index.ts" },
    { id: "hub", plugin: "plugins/hub/index.ts" },
    { id: "verdict", plugin: "plugins/verdict/index.ts" },
    { id: "words", plugin: "plugins/words/index.ts", config: { seed: SEED } },
    { id: "loaded", plugin: "plugins/loaded/index.ts" },
    { id: "transcript", plugin: "plugins/transcript/index.ts" },
    { id: "context", plugin: "plugins/context/index.ts" },
    { id: "call", plugin: "plugins/call/index.ts" },
    // A typed call's model: ARCHIPELAGO_MODEL names one (`anthropic:<model>`, `openai:<model>`, `claude[:<model>]`); its key stays in the environment.
    { id: "typed", plugin: "plugins/typed/index.ts", config: { model: process.env.ARCHIPELAGO_MODEL || undefined } },
    { id: "profile", plugin: "plugins/profile/index.ts" },
    { id: "used", plugin: "plugins/used/index.ts" },
    { id: "lean", plugin: "plugins/lean/index.ts" },
    { id: "lean-write", plugin: "plugins/lean/write.ts", config: { ledger: join(data, "lean.json") }, disabled: !write },
    { id: "written", plugin: "plugins/written/index.ts", disabled: !write },
    { id: "placed", plugin: "plugins/placed/index.ts", disabled: !write },
    { id: "grow", plugin: "plugins/grow/index.ts" },
    { id: "budget", plugin: "plugins/budget/index.ts" },
    { id: "keep", plugin: "plugins/keep/index.ts" },
    { id: "scripted", plugin: "plugins/scripted/index.ts" },
    { id: "replay", plugin: "plugins/replay/index.ts" },
    { id: "since", plugin: "plugins/since/index.ts" },
    // The exchange as OpenTelemetry spans to a collector: off until `otel.endpoint` names one (otelFromEnv).
    { id: "otel", plugin: "plugins/otel/index.ts", config: otel },
    {
      id: "claude-code",
      plugin: "plugins/claude-code/index.ts",
      config: { port: PAGE + 1, ...access, onListen: (p: number) => console.log(`claude-code adapter on http://127.0.0.1:${p}`) },
    },
    { id: "mcp", plugin: "plugins/mcp/index.ts" },
    // What a person copies to connect Claude Code: the adapter as this machine reaches it. A host in front sets its own.
    // A folder's sessions are connected from the page, as an item; its files written only by a server that writes and
    // has no host in front (a host never writes hooks into folders on its own machine).
    { id: "connect", plugin: "plugins/connect/index.ts", config: { hook: `http://127.0.0.1:${PAGE + 1}/hook`, mcp: `http://127.0.0.1:${PAGE + 1}/mcp`, writes: write && !origins.length && !hosts.length } },
    {
      id: "connect-write",
      plugin: "plugins/connect/write.ts",
      config: { hook: `http://127.0.0.1:${PAGE + 1}/hook`, mcp: `http://127.0.0.1:${PAGE + 1}/mcp`, ledger: join(data, "connect.json") },
      disabled: !write || !!origins.length || !!hosts.length,
    },
    // A host's way in to its maps (plugins/gate): off until a host in front names where it answers (`at`).
    { id: "gate", plugin: "plugins/gate/index.ts" },
    { id: "docs", plugin: "plugins/docs/index.ts" },
    { id: "docs-tool", plugin: "plugins/docs/tool.ts" },
    { id: "words-tool", plugin: "plugins/words/tool.ts" },
    { id: "archive", plugin: "plugins/archive/index.ts", config: { dir: join(data, "archives") } },
    {
      id: "bridge",
      plugin: "plugins/bridge/server.ts",
      config: {
        port: PAGE + 2,
        actor: { id: "person:owner", kind: "person" },
        ...access,
        onListen: (p: number) => console.log(`bridge on http://127.0.0.1:${p}`),
      },
    },
  ];
}
