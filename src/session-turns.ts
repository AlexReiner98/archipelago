// Moved to packs/sessions/kernel/session-turns.ts (docs/kernel-packs.md, "The shim"): this adapter keeps its importers
// passing the map until the gather step rewrites them. The view `turns` is the query pack's now.

import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/session-turns.ts';

export * from '../packs/sessions/kernel/session-turns.ts';

export const turns = async (l: Archipelago, input: Record<string, unknown>) => moved.turns((await import('./kernel-context.ts')).ownContext(l, 'sessions'), input);
