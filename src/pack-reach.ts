// What a workspace pack reaches beyond its own map, each given by the server, so the pack host imports none of it:
// a server pack's host read as this workspace's connection to that pack (a pack's via), and a model run it asks for
// (its runs), made by the kernel. And the hold that keeps a workspace open while what a pack started still runs.

import type { PackFile } from './packs.ts';
import { parts } from './manifest.ts';
import type { Actor, Archipelago } from './pelago.ts';

/** How the server reaches its server packs for a workspace: the connection the workspace made, and a read through it. */
export interface Reach {
  hold(workspace: string): () => void;
  connection(workspace: string, pack: string): Promise<{ id: string; account: string } | null>;
  /** A GET to a host the server pack lends, as the workspace's connection to it. */
  via(workspace: string, pack: string, host: string, path: string): Promise<{ status: number; body: unknown }>;
}

/** A model run a pack asks for: the kernel asks the workspace's model, and answers its tools, until it is done. */
export interface RunAsk {
  title: string;
  system: string;
  task: string;
  /** The pack's own tools, each answered by its handler's entry "tool" (given name, input and context). */
  tools?: { name: string; description: string; input_schema: Record<string, unknown> }[];
  /** The map's tools offered as they are, of those the pack declares in runs. */
  map_tools?: string[];
  /** What the run is held to; the run is recorded in the first. */
  within: string[];
  link?: string;
  /** Handed to each of its tool calls, and to then. */
  context?: unknown;
  /** What started it, in words ("a push to main"), when a person did not. */
  by?: string;
  /** The entry told how it ended, which may answer calls of the map's tools the pack declares in runs. */
  then?: string;
  /**
   * What it is a run of, to be run once (a push, by repository and head): whichever server asks first takes it, and
   * another asking is refused while it runs and for good once it has ended. One cut off is taken again after a while.
   */
  once?: string;
}

export interface RunStart {
  started: boolean;
  title: string;
  reason?: string;
}

/** Starts the runs a call asked for, given how it was called; each runs on after this answers. */
export type Runner = (l: Archipelago, actor: Actor, pack: PackFile, call: string, runs: RunAsk[]) => Promise<RunStart[]>;

let reach: Reach | undefined;
let runner: Runner | undefined;
export const setReach = (r: Reach | undefined) => void (reach = r);
export const setRunner = (r: Runner | undefined) => void (runner = r);

/** Keep a workspace open until what is returned is called. */
export const holdWorkspace = (workspace: string): (() => void) => reach?.hold(workspace) ?? (() => {});

export function startRuns(l: Archipelago, actor: Actor, pack: PackFile, call: string, runs: RunAsk[]): Promise<RunStart[]> {
  if (!runner) return Promise.resolve(runs.map((r) => ({ started: false, title: String(r.title), reason: 'This server runs no models for packs.' })));
  return runner(l, actor, pack, call, runs);
}

/** Not a question for here: the map's own reads answer it. */
export const NOT_BEYOND = Symbol('not beyond');

/** Answer what a pack asks beyond its map while its call runs: a connection it reads through, and a read through it. */
export async function answerBeyond(l: Archipelago, pack: PackFile, q: Record<string, unknown>): Promise<unknown> {
  const declared = (id: unknown, host?: unknown) => parts(pack).via.some((v) => v.pack === id && (host === undefined || v.host === host));
  if (typeof q.connection === 'string') {
    if (!declared(q.connection)) throw new Error(`The ${pack.id} pack declares no way through "${q.connection}".`);
    return reach ? reach.connection(l.workspace, q.connection) : null;
  }
  const r = q.request as { via?: unknown; host?: unknown; path?: unknown; method?: unknown } | undefined;
  if (!r || typeof r !== 'object') return NOT_BEYOND;
  if (r.via === undefined) throw new Error("A workspace pack's requests are made after its call (answer requests); while it runs it may only read through a server pack (via).");
  if (!declared(r.via, r.host)) throw new Error(`The ${pack.id} pack declares no way through ${String(r.via)}'s host "${String(r.host)}".`);
  if ((r.method ?? 'GET') !== 'GET') throw new Error('Through a server pack, only reads (GET).');
  if (typeof r.path !== 'string' || !r.path.startsWith('/')) throw new Error('A request names a path under the host, starting with /.');
  if (!reach) throw new Error('This server reaches no server packs.');
  return reach.via(l.workspace, r.via as string, r.host as string, r.path);
}
