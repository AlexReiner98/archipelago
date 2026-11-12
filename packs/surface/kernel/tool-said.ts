// What the schema a person reads (or one asked whole) says of the surface's tools and the server's surfaces, so the
// page names none of them: the acts that begin and end a session (a tool's begins and ends); the reads an agent
// reaches through query, the kernel's first and then those its packs declare, the one that reads an item whole marked
// (whole); and what the surface that was before there were surfaces says of the names then used (before: the actor its
// hooks act as), from the server's packs.

import { adapterBefore } from '../../loader/kernel/server-adapter.ts';
import type { ServerPacks } from './server-host.ts';
import { queryReads } from './surface.ts';
import type { Tool } from './tools.ts';

/** The server's packs, set by the server when it starts; none where the tools are called without one. */
let serverPacks: Pick<ServerPacks, 'packs'> | undefined;
export function configureSaid(packs: Pick<ServerPacks, 'packs'> | undefined): void {
  serverPacks = packs;
}

/** The reads an agent reaches through query, the one that reads an item whole marked: all a reader's page asks of the schema (reads: true). */
export const readsSaid = (tools: Record<string, Tool>) => queryReads(tools).map((name) => ({ name, ...(tools[name].whole && { whole: true }) }));

/** The schema's answer with what the tools declare; an answer of one type, or the brief an agent is given, as it was. */
export function toolsSaid(said: unknown, tools: Record<string, Tool>): unknown {
  if (!said || typeof said !== 'object' || !('pack_tools' in said)) return said;
  const named = (flag: 'begins' | 'ends') => Object.keys(tools).find((name) => tools[name][flag]);
  const reads = readsSaid(tools);
  const before = serverPacks && adapterBefore(serverPacks)?.before;
  return { ...said, acts: { begins: named('begins'), ends: named('ends') }, reads, ...(before && { before }) };
}
