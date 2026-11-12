// A workspace's lifecycle (docs/kernel-packs.md, "Slots" and "The boot stub", step 5): it opens phase by phase, each
// phase a slot `open.<phase>` that packs fill, and while this server leads it runs the duties packs declare: timers,
// and anything else started on the lead and stopped when it is lost. Workspaces.load (src/workspaces.ts) runs no step
// of its own any more; it opens the database, hands it here and builds the workspace from what the phases made.
//
// Two kinds of filling, run in this order in each phase:
//   - the kernel's own, registered with onOpen and whileLeading/timer from the module that holds the code, under the
//     pack it moves to (the table in docs/kernel-packs.md). Within a phase they run in the order they were registered:
//     src/open-steps.ts imports the modules that register them, in that order. A wave-2 step that moves a module
//     moves its registration with it and changes only that import line;
//   - an internal pack's, declared in its manifest: `kernel.hooks["open.<phase>"]` and `kernel.timers`, in pack order,
//     each called with its pack's KernelContext (src/kernel-context.ts). The registry is made in the `packs` phase, so
//     a pack's manifest can fill only the phases after it: types (once its host is open), begin, islands and ready.

import { OPEN_PHASES } from './boot.ts';
import type { Dump } from './backup.ts';
import type { Database } from './db.ts';
import { hostOf } from './kernel-context.ts';
import type { Registry } from './packs.ts';
import type { Archipelago } from './pelago.ts';
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

/** What fills each phase, by the pack that fills it: the kernel's own registered here; the manifests' are read at open. */
export function kernelFillings(): { phase: Phase; pack: string }[] {
  return steps.map(({ phase, pack }) => ({ phase, pack }));
}

/** The duties the kernel registered, by pack. */
export const kernelDuties = (): string[] => duties.map((d) => d.pack);

/** Open a workspace phase by phase: each phase's kernel steps, then the internal packs' fillings. Answers the map the packs phase made. */
export async function openPhases(o: Opening): Promise<Archipelago> {
  for (const phase of OPEN_PHASES) {
    for (const s of steps) if (s.phase === phase) await s.run(o);
    const host = o.pelago && hostOf(o.pelago);
    if (host) for (const f of await host.fillings(o.pelago!, `open.${phase}`)) await f.run();
  }
  if (!o.pelago) throw new Error(`${o.id} did not open: no step of the packs phase made its map`);
  return o.pelago;
}

/**
 * Start what runs in a workspace while this server leads: the kernel's duties, then the timers its internal packs
 * declare. A duty that fails to start is said and the rest still start. Answers what stops them all.
 */
export function startDuties(ws: Workspace): () => void {
  const stops: (() => void)[] = [];
  for (const d of duties) {
    try {
      stops.push(d.start(ws));
    } catch (err) {
      console.error(`starting ${d.pack}'s duty in ${ws.id} failed: ${(err as Error).message}`);
    }
  }
  for (const t of hostOf(ws.pelago)?.timers(ws.pelago) ?? []) {
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
