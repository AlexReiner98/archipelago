// A workspace's lifecycle (docs/kernel-packs.md, "Slots" and "The boot stub", step 5): it opens phase by phase, each
// phase a slot `open.<phase>` that packs fill, and while this server leads it runs the duties packs declare: timers,
// and anything else started on the lead and stopped when it is lost. Workspaces.load (src/workspaces.ts) runs no step
// of its own any more; it opens the database, hands it here and builds the workspace from what the phases made.
//
// Three kinds of filling, run in this order in each phase:
//   - a root pack's, declared by the root itself: its `kernel/open.ts` exports OPEN (the steps it fills, by phase) and
//     LEADING (what it runs while this server leads), read in the order packs/roots.json starts the roots. The
//     identity root asks no root above it by name: it reads what each declares, as the stub reads their start.
//   - the kernel's own, registered with onOpen and whileLeading/timer from the module that holds the code, under the
//     pack it moves to: what the kernel still does while this server leads (the quiet sessions timer, src/workspaces.ts),
//     until its step moves it, with its filling, into the pack.
//   - an internal pack's, declared in its manifest: `kernel.hooks["open.<phase>"]` and `kernel.timers`, in pack order,
//     each called with its pack's KernelContext. The loader fills the slot (fillOpen) when it opens a map's packs
//     (openKernel, src/kernel-context.ts): the registry is made in the `packs` phase, so a pack's manifest can fill
//     only the phases after it: types (once its host is open), begin, islands and ready.

import { OPEN_PHASES } from './open-phases.ts';
import type { Dump } from '../../log/kernel/backup.ts';
import type { Database } from '../../database/kernel/db.ts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Registry } from '../../loader/kernel/packs.ts';
import type { Archipelago } from '../../write/kernel/pelago.ts';
import type { Workspace, WorkspacesConfig } from './workspaces.ts';

export type Phase = (typeof OPEN_PHASES)[number];

/** What a workspace's opening carries from phase to phase: what it starts with, and what each phase makes. */
export interface Opening {
  id: string;
  /** Its name, as the list of workspaces has it. */
  name: string;
  isDefault: boolean;
  db: Database;
  /** What it is made from, when it is made from a backup. */
  backup?: Dump;
  /** Made here just now, empty (Workspaces.create): put on islands as it opens, as every new map is. */
  made?: boolean;
  /** Nothing on its log and nothing brought in: a new workspace, opened for the first time. */
  begins: boolean;
  config: WorkspacesConfig;
  /** The database that keeps which workspaces there are. */
  control(): Promise<Database>;
  /** Made in the packs phase. */
  registry?: Registry;
  pelago?: Archipelago;
}

interface Step {
  phase: Phase;
  pack: string;
  run: (o: Opening) => unknown;
}

/** A duty: started for a workspace while this server leads, and stopped by what its start answers. */
export interface Duty {
  pack: string;
  start: (ws: Workspace) => () => void;
}

const steps: Step[] = [];
const duties: Duty[] = [];

/** What a root pack declares in its kernel/open.ts: the steps it fills, by phase, and what it runs while this server leads. */
export type RootOpen = { [P in Phase]?: ((o: Opening) => unknown)[] };
export type RootLeading = ((ws: Workspace) => () => void)[];
/** What a root does to catch an open workspace up with what other servers changed in it (FOLLOW), and as it closes (CLOSE). */
export type RootFollow = ((ws: Workspace) => Promise<unknown>)[];
export type RootClose = ((ws: Workspace) => unknown)[];

/** The packs folder whose roots.json and root packs are read. */
const PACKS = join(import.meta.dirname, '..', '..');
let rooted: Promise<{ steps: Step[]; duties: Duty[] }> | undefined;
let rootDuties: Duty[] = [];
const rootFollow: RootFollow = [];
const rootClose: RootClose = [];

/** The roots' fillings, in the order roots.json starts them: each root's kernel/open.ts, read once. */
function rootFillings(): Promise<{ steps: Step[]; duties: Duty[] }> {
  rooted ??= (async () => {
    const out = { steps: [] as Step[], duties: [] as Duty[] };
    const { roots = [] } = JSON.parse(readFileSync(join(PACKS, 'roots.json'), 'utf8')) as { roots?: { id: string }[] };
    for (const { id } of roots) {
      const file = join(PACKS, id, 'kernel', 'open.ts');
      if (!existsSync(file)) continue;
      const mod = (await import(pathToFileURL(file).href)) as { OPEN?: RootOpen; LEADING?: RootLeading; FOLLOW?: RootFollow; CLOSE?: RootClose };
      rootFollow.push(...(mod.FOLLOW ?? []));
      rootClose.push(...(mod.CLOSE ?? []));
      for (const phase of OPEN_PHASES) for (const run of mod.OPEN?.[phase] ?? []) out.steps.push({ phase, pack: id, run });
      for (const start of mod.LEADING ?? []) out.duties.push({ pack: id, start });
    }
    rootDuties = out.duties;
    return out;
  })();
  return rooted;
}

/**
 * The slot the loader fills at a map's open (openKernel, src/kernel-context.ts): its internal packs' fillings of a
 * point and their timers, each bound to its pack's context. Identity sits below the loader and never imports it.
 */
export interface PackOpen {
  fillings(point: string): Promise<{ run: () => Promise<unknown> }[]>;
  timers(): { pack: string; every_ms: number; leading: boolean; fire: () => Promise<unknown> }[];
}
const packOpen = new WeakMap<object, PackOpen>();
/** Fill the slot for a map's registry: the loader, when it opens the map's packs. */
export const fillOpen = (registry: object, filled: PackOpen): void => void packOpen.set(registry, filled);

/** Fill the slot `open.<phase>` with a step of the kernel's, under the pack whose code it is. */
export function onOpen(phase: Phase, pack: string, run: (o: Opening) => unknown): void {
  if (!(OPEN_PHASES as readonly string[]).includes(phase)) throw new Error(`open.${phase} is no phase: one of ${OPEN_PHASES.join(', ')}`);
  steps.push({ phase, pack, run });
}

/** Run something in each workspace while this server leads: `start` answers what stops it. */
export function whileLeading(pack: string, start: (ws: Workspace) => () => void): void {
  duties.push({ pack, start });
}

/** Call `tick` every `ms`, and at once when `leading`, never keeping the process alive by itself. Answers what stops it. */
export function every(ms: number, tick: () => void, leading = false): () => void {
  if (leading) tick();
  const t = setInterval(tick, ms).unref();
  return () => clearInterval(t);
}

/** A timer of the kernel's, under its pack: run in each workspace every `every_ms` while this server leads. A failure is said, or handed to `failed`. */
export function timer(pack: string, every_ms: number, run: (ws: Workspace) => unknown, options: { leading?: boolean; failed?: (ws: Workspace, err: Error) => void } = {}): void {
  whileLeading(pack, (ws) => {
    const failed = options.failed ?? ((w: Workspace, err: Error) => console.error(`${pack}'s timer in ${w.id} failed: ${err.message}`));
    const tick = () => {
      try {
        void Promise.resolve(run(ws)).catch((err: Error) => failed(ws, err));
      } catch (err) {
        failed(ws, err as Error);
      }
    };
    return every(every_ms, tick, options.leading);
  });
}

/** Catch an open workspace up with what other servers changed in it, as each root says (its FOLLOW): a type kept or a pack switched elsewhere. */
export async function followRoots(ws: Workspace): Promise<void> {
  await rootFillings();
  for (const follow of rootFollow) await follow(ws);
}

/** What each root does as a workspace closes (its CLOSE), before its database is closed: the loader stops its packs' processes. */
export async function closeRoots(ws: Workspace): Promise<void> {
  await rootFillings();
  for (const close of rootClose) await close(ws);
}

/** What fills each phase, by the pack that fills it: the roots' in their order, then the kernel's own registered here; the manifests' are read at open. */
export async function kernelFillings(): Promise<{ phase: Phase; pack: string }[]> {
  const roots = await rootFillings();
  return OPEN_PHASES.flatMap((phase) => [...roots.steps, ...steps].filter((s) => s.phase === phase).map(({ pack }) => ({ phase, pack })));
}

/** The duties the roots declare and the kernel registered, by pack. */
export const kernelDuties = async (): Promise<string[]> => [...(await rootFillings()).duties, ...duties].map((d) => d.pack);

/** Open a workspace phase by phase: each phase's kernel steps, then the internal packs' fillings. Answers the map the packs phase made. */
export async function openPhases(o: Opening): Promise<Archipelago> {
  const roots = await rootFillings();
  for (const phase of OPEN_PHASES) {
    for (const s of [...roots.steps, ...steps]) if (s.phase === phase) await s.run(o);
    const packs = o.pelago && packOpen.get(o.pelago.registry);
    if (packs) for (const f of await packs.fillings(`open.${phase}`)) await f.run();
  }
  if (!o.pelago) throw new Error(`${o.id} did not open: no step of the packs phase made its map`);
  return o.pelago;
}

/**
 * Start what runs in a workspace while this server leads: the roots' duties and the kernel's, then the timers its internal packs
 * declare. A duty that fails to start is said and the rest still start. Answers what stops them all.
 */
export function startDuties(ws: Workspace): () => void {
  const stops: (() => void)[] = [];
  for (const d of [...rootDuties, ...duties]) {
    try {
      stops.push(d.start(ws));
    } catch (err) {
      console.error(`starting ${d.pack}'s duty in ${ws.id} failed: ${(err as Error).message}`);
    }
  }
  for (const t of packOpen.get(ws.pelago.registry)?.timers() ?? []) {
    const tick = () => void t.fire().catch((err: Error) => console.error(`${t.pack}'s timer in ${ws.id} failed: ${err.message}`));
    stops.push(every(t.every_ms, tick, t.leading));
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    for (const stop of stops) {
      try {
        stop();
      } catch (err) {
        console.error(`stopping a duty in ${ws.id} failed: ${(err as Error).message}`);
      }
    }
  };
}
