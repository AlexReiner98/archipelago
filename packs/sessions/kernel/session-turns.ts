// A run's turns as a view (docs/sessions.md, "Wired"): the runs pack reads them (answer.turns, packs/runs/kernel/run-turns.ts),
// newest first, with the names of the sessions that started any of them; this names that read the view `turns`. A run's
// page draws them along time (ui/turns.js), its beats among them.

import type { Archipelago } from '../../../src/pelago.ts';
import { VIEWS } from '../../../src/views.ts';

/** A run's turns, newest first, as "A turn" has them; `more` counts the older ones left out: the runs pack's answer, asked as the map that asks. */
export async function turns(l: Archipelago, input: Record<string, unknown>) {
  return (await import('../../../src/kernel-context.ts')).callAs(l, 'answer.turns', input);
}

VIEWS.turns = {
  description:
    'A session’s turns, newest first, worked out from the events its adapter sent (docs/sessions.md, "A turn"): each with who started it (by, from), the prompt’s gist, its tools by kind, files and items, tests, commits, waits, how it ended (end, question, reply) and its tokens; an open turn has no end. names gives the title and name of each session that started one; more counts the older turns left out. Params: run (required): a run id or session id; limit (50, at most 200).',
  run: turns,
};
