/**
 * The server's config tree and the words it seeds: what app/server.ts runs.
 * Kept apart from the server so a host can start from it (`serverTree`) and
 * add its own packs, through the same loader.
 */
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
    words: "This run is recorded on the exchange: every say, refusal and act shows live in the sensory interface.",
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
  /** Where the packs keep their data. */
  data: string;
  /** The page's port: the adapter listens one above it, the bridge two. */
  port: number;
  /** Whether the written pack writes skill and memory files. */
  write: boolean;
  /** More origins the page, the adapter and the bridge answer, besides the page's own (a host in front of them). */
  origins?: string[];
  /** More Host values they answer (a proxy in front that keeps its own). */
  hosts?: string[];
}

/** What the page server is given, so that it answers the same as the adapter and the bridge. */
export function pageAccess({ port: PAGE, origins = [], hosts = [] }: Pick<TreeOptions, "port" | "origins" | "hosts">) {
  return { origins: [...localOrigins(PAGE), ...origins], hosts };
}

/**
 * The server's config tree. A host that runs the server its own way (more
 * packs, another front) starts from this tree and adds to it.
 */
export function serverTree({ data, port: PAGE, write, origins = [], hosts = [] }: TreeOptions): Entry[] {
  // The app's own origin is the page's: the adapter and the bridge answer it, and a host's in front.
  const access = pageAccess({ port: PAGE, origins, hosts });
  return [
    { id: "graph", pack: "packs/graph/index.ts", config: { db: join(data, "graph.sqlite") } },
    { id: "action", pack: "packs/action/index.ts" },
    { id: "types", pack: "packs/types/index.ts" },
    { id: "work", pack: "packs/work/index.ts" },
    { id: "question", pack: "packs/question/index.ts" },
    { id: "record", pack: "packs/record/index.ts" },
    { id: "actor", pack: "packs/actor/index.ts" },
    { id: "links", pack: "packs/links/index.ts" },
    { id: "branch", pack: "packs/branch/index.ts" },
    { id: "items", pack: "packs/items/index.ts" },
    { id: "page", pack: "packs/page/index.ts" },
    { id: "views", pack: "packs/views/index.ts" },
    { id: "switch", pack: "packs/switch/server.ts" },
    { id: "schema", pack: "packs/schema/index.ts", config: { db: join(data, "schema.sqlite") } },
    { id: "history", pack: "packs/history/index.ts", config: { db: join(data, "history.sqlite") } },
    { id: "interchange", pack: "packs/interchange/index.ts" },
    { id: "exchange", pack: "packs/exchange/index.ts", config: { journal: join(data, "exchange.jsonl") } },
    { id: "agent", pack: "packs/agent/index.ts" },
    { id: "git", pack: "packs/git/index.ts" },
    { id: "hub", pack: "packs/hub/index.ts" },
    { id: "verdict", pack: "packs/verdict/index.ts" },
    { id: "words", pack: "packs/words/index.ts", config: { seed: SEED } },
    { id: "loaded", pack: "packs/loaded/index.ts" },
    { id: "profile", pack: "packs/profile/index.ts" },
    { id: "written", pack: "packs/written/index.ts", disabled: !write },
    { id: "placed", pack: "packs/placed/index.ts", disabled: !write },
    { id: "grow", pack: "packs/grow/index.ts" },
    { id: "keep", pack: "packs/keep/index.ts" },
    { id: "since", pack: "packs/since/index.ts" },
    {
      id: "claude-code",
      pack: "packs/claude-code/index.ts",
      config: { port: PAGE + 1, ...access, onListen: (p: number) => console.log(`claude-code adapter on http://127.0.0.1:${p}`) },
    },
    { id: "mcp", pack: "packs/mcp/index.ts" },
    { id: "docs", pack: "packs/docs/index.ts" },
    { id: "docs-tool", pack: "packs/docs/tool.ts" },
    { id: "archive", pack: "packs/archive/index.ts", config: { dir: join(data, "archives") } },
    {
      id: "bridge",
      pack: "packs/bridge/server.ts",
      config: {
        port: PAGE + 2,
        actor: { id: "person:owner", kind: "person" },
        ...access,
        onListen: (p: number) => console.log(`bridge on http://127.0.0.1:${p}`),
      },
    },
  ];
}
