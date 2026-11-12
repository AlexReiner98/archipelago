// Moved to packs/placement/kernel/subject.ts (docs/kernel-packs.md, "Moving a service in the wave"): this shim keeps its
// importers working until the gather step rewrites them. What took the map is handed the pack's context of it, made
// when it is called (kernelContext), so this module imports nothing the reads import.

import type { Archipelago } from './pelago.ts';
import type { Op } from './pelago-types.ts';
import type { Registry } from './packs.ts';
import * as moved from '../packs/placement/kernel/subject.ts';

export * from '../packs/placement/kernel/subject.ts';

/** The placement pack's context of a map. */
const ctx = async (l: Archipelago) => (await import('./kernel-context.ts')).kernelContext(l, 'placement');

export const placeWithSubject = async (l: Archipelago, reg: Registry, ops: Op[]) => moved.placeWithSubject(await ctx(l), reg, ops);
export const subjectRefusals = async (l: Archipelago, reg: Registry, ops: Op[]) => moved.subjectRefusals(await ctx(l), reg, ops);
