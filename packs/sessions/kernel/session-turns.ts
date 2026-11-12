// A run's turns (docs/sessions.md, "Wired"): the runs pack reads them (answer.turns, packs/runs/kernel/run-turns.ts),
// newest first, with the names of the sessions that started any of them; the query pack names that read its view
// `turns`. A run's page draws them along time (ui/turns.js), its beats among them.

import type { KernelContext } from '#pelago/kernel';

/** A run's turns, newest first, as "A turn" has them; `more` counts the older ones left out: the runs pack's answer. */
export const turns = (ctx: KernelContext, input: Record<string, unknown>) => ctx.call('answer.turns', input);
