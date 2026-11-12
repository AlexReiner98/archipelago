// The surface's slots (docs/kernel-packs.md, "Slots"): what the tool surface asks of the packs above it, as lists the
// loader fills, empty by default. The surface keeps the ten verbs, each action's words (its description and input)
// and who may call it (src/tools.ts, callTool); what an action does, a read answers or an HTTP route serves is a
// filling.
//
// - `surface.act`, `surface.read`: an action's or a read's behaviour, by its name. An internal pack fills one with a
//   hook whose export is named for it (`"surface.act": "recheck.ts#rechecked"`), called with its KernelContext, the
//   input and who asked. Until its step moves it into a pack, a kernel module fills one from KERNEL_FILLINGS
//   (src/surface-fillings.ts), called as the surface's own tools are.
// - `surface.route`: an HTTP route the server answers, matched by method and path before the server's own.
// - `surface.reads`: a read of the reads API (`answerRead`, ./packreads.ts) a service answers, by its key
//   (`"surface.reads": "reads.ts#instructions"`), called with its KernelContext of the map that asks (so it reads as
//   the asker, under row-level security) and the whole read. The reads API names no service: a filling is asked
//   where its read was answered before, so a read with several keys is answered as it was.
//
// One owner: a name filled twice (by two packs, or by a pack and the kernel) is refused when it is called, naming
// both, as two packs declaring one type are. Swapping who fills one is taking one out and putting the other in.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostAt, hostOf } from '../../../src/kernel-context.ts';
import { KERNEL_FILLINGS } from '../../../src/surface-fillings.ts';
import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { actorId } from '../../../src/pelago-types.ts';
import type { Workspaces } from '../../../src/workspaces.ts';

/** The slots the tool surface opens. */
export const SURFACE_SLOTS = ['surface.act', 'surface.read', 'surface.route', 'surface.reads'] as const;
export type ToolSlot = 'surface.act' | 'surface.read';

/** What a tool's filling runs, as the surface's own tools do. */
export type ToolRun = (l: Archipelago, actor: Actor, input: any) => Promise<unknown>;

/** Who called, as a pack's filling is told it: never the actor's tokens or scope, which the surface has checked. */
export interface Caller { kind: Actor['kind']; name: string }

/** What the server hands a route's filling: the workspaces, and the address limits it counts requests against. */
export interface RouteHost {
  workspaces: Workspaces;
  /** True, and the request answered with 429, when its address has asked too often under this limit. */
  tooOften(limit: 'open' | 'deliveries' | 'signIn'): boolean;
}

/** An HTTP route a filling answers: the server tries each, in order, before its own. */
export interface RouteFilling {
  method: 'GET' | 'POST';
  path: RegExp;
  serve(req: IncomingMessage, res: ServerResponse, match: RegExpExecArray, host: RouteHost): Promise<unknown>;
}

/** What a kernel module's filling of surface.reads runs: the map that asks, the whole read, and the internal pack asking, when one is. */
export type ReadRun = (l: Archipelago, read: any, pack?: string) => Promise<unknown>;

/** The kernel modules that fill each slot, by name: those a pack does not yet hold. */
export type KernelFillings = { [S in ToolSlot]: Record<string, ToolRun> } & { 'surface.route': Record<string, RouteFilling>; 'surface.reads': Record<string, ReadRun> };

type Found = { by: string; run: ToolRun };

/** Every filling of a tool slot here: the kernel's own, then each internal pack's, in pack order. */
async function fillingsOf(l: Archipelago, slot: ToolSlot, name: string): Promise<Found[]> {
  const out: Found[] = [];
  const own = KERNEL_FILLINGS[slot][name];
  if (own) out.push({ by: 'the kernel', run: own });
  const host = hostOf(l);
  for (const f of host ? await host.fillings(l, slot) : []) {
    if (f.ref.slice(f.ref.indexOf('#') + 1) !== name) continue;
    out.push({ by: `the ${f.pack} pack`, run: (_l, actor, input) => f.run(input, { kind: actor.kind, name: actorId(actor) } satisfies Caller) });
  }
  return out;
}

/** What fills a tool slot's name here, or undefined when nothing does; refused when two do. */
export async function filledTool(l: Archipelago, slot: ToolSlot, name: string): Promise<ToolRun | undefined> {
  const found = await fillingsOf(l, slot, name);
  if (found.length > 1) throw new Error(`${name} is filled by ${found.map((f) => f.by).join(' and ')}: one name, one owner (${slot})`);
  return found[0]?.run;
}

/** A tool's run that answers with what fills its slot: the surface keeps the action's words, a filling its behaviour. */
export const slotted = (slot: ToolSlot, name: string): ToolRun => async (l, actor, input) => {
  const run = await filledTool(l, slot, name);
  if (!run) throw new Error(`Nothing here fills ${name} (${slot}): the pack that does it is not running.`);
  return run(l, actor, input);
};

/**
 * A pack's own action whose code runs in-process: an internal pack declares the action (its words, and its verb, which
 * may be a verb the pack declares itself) and fills surface.act with an export named for it, the part of its id after
 * the pack's name and its dot. Only the declaring pack's filling counts. Undefined when none does: the
 * action then runs in the sandbox, as any pack's.
 */
export async function packAct(l: Archipelago, tool: string): Promise<ToolRun | undefined> {
  const found = l.registry.tools.get(tool);
  const host = hostOf(l);
  if (!found || !('verb' in found.def) || !host) return undefined; // an action says its verb; a view does not
  const def = found.def as { id: string; humanOnly?: boolean; admin?: boolean };
  const name = def.id.slice(def.id.indexOf('.') + 1);
  const filled = (await host.fillings(l, 'surface.act')).find((f) => f.pack === found.pack && f.ref.slice(f.ref.indexOf('#') + 1) === name);
  if (!filled) return undefined;
  return async (_l, actor, input) => {
    // Who may call it, as the sandbox's runner checks (src/packtools.ts).
    if (def.humanOnly && actor.kind !== 'human') throw new Error(`"${def.id}" is for humans only.`);
    if (def.admin && !(actor.kind === 'human' && actor.admin)) throw new Error(`"${def.id}" is for a workspace's admins only: what it starts is paid for by the workspace.`);
    return filled.run(input, { kind: actor.kind, name: actorId(actor) } satisfies Caller);
  };
}

/**
 * The answer to a read of the reads API by what fills its key in surface.reads: the kernel's own, or an internal
 * pack's, on any map (one no workspace opened too: a test's, or a person's view of one). Refused when two fill it,
 * and when nothing does.
 */
export async function answerFilled(l: Archipelago, key: string, read: unknown, pack?: string): Promise<unknown> {
  const found: { by: string; run: () => Promise<unknown> }[] = [];
  const own = KERNEL_FILLINGS['surface.reads'][key];
  if (own) found.push({ by: 'the kernel', run: () => own(l, read, pack) });
  for (const f of await hostAt(l).fillings(l, 'surface.reads')) {
    if (f.ref.slice(f.ref.indexOf('#') + 1) === key) found.push({ by: `the ${f.pack} pack`, run: () => f.run(read) });
  }
  if (found.length > 1) throw new Error(`${key} is filled by ${found.map((f) => f.by).join(' and ')}: one name, one owner (surface.reads)`);
  if (!found.length) throw new Error(`Nothing here answers the read ${key} (surface.reads): the pack that does it is not running.`);
  return found[0].run();
}

/** The routes the kernel's modules fill, in order. */
export const filledRoutes = (): RouteFilling[] => Object.values(KERNEL_FILLINGS['surface.route']);

/** Serve a request by the first route filling that matches it: true when one did. */
export async function serveFilled(req: IncomingMessage, res: ServerResponse, path: string, host: RouteHost): Promise<boolean> {
  for (const route of filledRoutes()) {
    const match = req.method === route.method ? route.path.exec(path) : null;
    if (!match) continue;
    await route.serve(req, res, match, host);
    return true;
  }
  return false;
}
