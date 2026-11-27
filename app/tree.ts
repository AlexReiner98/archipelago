/**
 * The server's config tree and the words it seeds: what app/server.ts runs.
 * Kept apart from the server so a host can start from it (`serverTree`) and
 * add its own plugins, through the same loader.
 */
import type { PluginFolders } from "../plugins/claude-code/registry.ts";
import { join } from "node:path";
import type { Entry } from "../runtime/loader.ts";
import { localOrigins } from "../runtime/guard.ts";

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
    words: "This run is recorded on the exchange: every say, refusal and act shows live on the map's page.",
  },
  {
    title: "No secrets",
    kind: "rule",
    at: ["file:.env", "file:**/.env"],
    words: "The map refuses .env files: they hold secrets.",
    refuse: true,
  },
  {
    title: "A new idea fits the schema",
    kind: "rule",
    at: ["file:plugins/**", "file:**/plugins/**"],
    words: [
      "Fit a plugin's data to the types there are before defining any (spec/types.md, Fitting a new idea):",
      "a thing in a model or design is a record (current until superseded); a field (`kind`) before a flavour, and a flavour only adds fields;",
      "a relation is a kind of link, with a few fields if it needs them, and a grouping is `part_of`, never a field;",
      "geometry is a json field with its shape and unit in its doc ([x,y,z] in cm), not a new kind of field;",
      "the graph holds what was chosen, not what was computed: a solve or layout is rebuilt from the items, or kept as one record about them that the next supersedes, never an item per particle or frame;",
      "write only through declared actions (items.create, items.set, items.link), read in bounded pages, and ask schema.check whether facts fit before sending them.",
      "A new base or kind of field is a question for the spec's owner.",
    ].join(" "),
  },
];


export interface TreeOptions {
  /** Where the plugins keep their data. */
  data: string;
  /** The page's port: the adapter listens one above it, the bridge two. */
  port: number;
  /** Whether the server writes files outside its data: a connected folder's hooks and MCP server. */
  write: boolean;
  /** More origins the page, the adapter and the bridge answer, besides the page's own (a host in front of them). */
  origins?: string[];
  /** More Host values they answer (a proxy in front that keeps its own). */
  hosts?: string[];
  /** The checkout people work in, when it isn't the one the server runs from (the live server's): what the page offers to connect. */
  checkout?: string;
  /** Which code and map this server is, for the page's header (plugins/serving): its checkout, its map when it serves one by name, its commit. */
  serving?: { root?: string; map?: string; commit?: string; folders?: PluginFolders };
}

/** What the page server is given, so that it answers the same as the adapter and the bridge. */
export function pageAccess({ port: PAGE, origins = [], hosts = [] }: Pick<TreeOptions, "port" | "origins" | "hosts">) {
  return { origins: [...localOrigins(PAGE), ...origins], hosts };
}

/**
 * The server's config tree. A host that runs the server its own way (more
 * plugins, another front) starts from this tree and adds to it.
 */
export function serverTree({ data, port: PAGE, write, origins = [], hosts = [], checkout, serving = {} }: TreeOptions): Entry[] {
  // The app's own origin is the page's: the adapter and the bridge answer it, and a host's in front.
  const access = pageAccess({ port: PAGE, origins, hosts });
  // A map served by name: the folders connected to it report by that name, so they follow it to any port (plugins/connect).
  const map = serving.map;
  const hosted = !!origins.length || !!hosts.length;
  return [
    { id: "graph", plugin: "plugins/graph/index.ts", config: { db: join(data, "graph.sqlite") } },
    { id: "action", plugin: "plugins/action/index.ts" },
    { id: "types", plugin: "plugins/types/index.ts" },
    { id: "work", plugin: "plugins/work/index.ts" },
    { id: "question", plugin: "plugins/question/index.ts" },
    { id: "record", plugin: "plugins/record/index.ts" },
    { id: "actor", plugin: "plugins/actor/index.ts" },
    { id: "links", plugin: "plugins/links/index.ts" },
    { id: "items", plugin: "plugins/items/index.ts" },
    { id: "page", plugin: "plugins/page/index.ts" },
    { id: "views", plugin: "plugins/views/index.ts" },
    { id: "switch", plugin: "plugins/switch/server.ts" },
    { id: "schema", plugin: "plugins/schema/index.ts", config: { db: join(data, "schema.sqlite") } },
    { id: "history", plugin: "plugins/history/index.ts", config: { db: join(data, "history.sqlite") } },
    { id: "interchange", plugin: "plugins/interchange/index.ts" },
    // Syncs this map with another, both ways, on `npm run map -- sync` (plugins/sync).
    { id: "sync", plugin: "plugins/sync/index.ts", config: { db: join(data, "sync.sqlite"), ...(map ? { name: map } : {}) } },
    { id: "exchange", plugin: "plugins/exchange/index.ts", config: { journal: join(data, "exchange.jsonl") } },
    { id: "agent", plugin: "plugins/agent/index.ts" },
    { id: "git", plugin: "plugins/git/index.ts" },
    { id: "hub", plugin: "plugins/hub/index.ts" },
    // Agents on one repository agree on a shared plan, kept on the map: a write to a file another live run holds is refused (plugins/claim).
    { id: "claim", plugin: "plugins/claim/index.ts" },
    { id: "words", plugin: "plugins/words/index.ts", config: { seed: SEED } },
    { id: "call", plugin: "plugins/call/index.ts" },
    { id: "scripted", plugin: "plugins/scripted/index.ts" },
    {
      id: "claude-code",
      plugin: "plugins/claude-code/index.ts",
      config: { port: PAGE + 1, ...access, onListen: (p: number) => console.log(`claude-code adapter on http://127.0.0.1:${p}`) },
    },
    { id: "mcp", plugin: "plugins/mcp/index.ts" },
    // What a person copies to connect Claude Code: the adapter as this machine reaches it. A host in front sets its own.
    // A folder's sessions are connected from the page, as an item; its files written only by a server that writes and
    // has no host in front (a host never writes hooks into folders on its own machine).
    { id: "connect", plugin: "plugins/connect/index.ts", config: { hook: `http://127.0.0.1:${PAGE + 1}/hook`, mcp: `http://127.0.0.1:${PAGE + 1}/mcp`, writes: write && !hosted, ...(checkout ? { folder: checkout } : {}), ...(map ? { map } : {}) } },
    {
      id: "connect-write",
      plugin: "plugins/connect/write.ts",
      config: { hook: `http://127.0.0.1:${PAGE + 1}/hook`, mcp: `http://127.0.0.1:${PAGE + 1}/mcp`, ledger: join(data, "connect.json"), ...(map ? { map } : {}) },
      disabled: !write || hosted,
    },
    // Which map, commit and checkout this is, for the page's header. A host in front shows no folder of its machine.
    { id: "serving", plugin: "plugins/serving/index.ts", config: { port: PAGE, ...(map ? { map } : {}), ...(serving.commit ? { commit: serving.commit } : {}), ...(serving.root && !hosted ? { checkout: serving.root } : {}), ...(serving.folders && !hosted ? { folders: serving.folders } : {}) } },
    { id: "docs", plugin: "plugins/docs/index.ts" },
    { id: "docs-tool", plugin: "plugins/docs/tool.ts" },
    { id: "words-tool", plugin: "plugins/words/tool.ts" },
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
