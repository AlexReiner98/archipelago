// Moved to packs/sessions/kernel/hook-answers.ts (docs/kernel-packs.md, "The shim"): this adapter keeps its callers
// handing the map the hook's token reads (pelago) until the gather step rewrites them, the call answered on the sessions
// pack's context of that map.

import type { Q } from './db.ts';
import type { Archipelago } from './pelago.ts';
import * as moved from '../packs/sessions/kernel/hook-answers.ts';

export * from '../packs/sessions/kernel/hook-answers.ts';

/** A hook as the server hands it: the map as the token's person sees it, and what the pack answers it from. */
export interface HookCall extends moved.HookAsk {
  /** The whole workspace's database, as callers hand it still: no longer read, since what one request leaves for the next is kept through root.transient. */
  whole?: Q;
  /** The map as the token's person sees it. */
  pelago: Archipelago;
}

/** What a session is told at one hook, or undefined for an event there is none for. */
export const sessionAnswer = async (event: string, { pelago, whole: _whole, ...call }: HookCall) =>
  moved.sessionAnswer((await import('./kernel-context.ts')).ownContext(pelago, 'sessions'), event, call);
