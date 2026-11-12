// What `report rechecked` does: the scheduled re-check of a repository said done, so each project waiting for one
// starts its interval again: the surface's own act (src/tool-acts.ts), since the pack that keeps the recheck view is
// a hosted one, a plain pack with no code in the server.
// The view is asked through the surface's slot surface.reads (`view`), which the pack that answers views fills: the
// surface asks no module above it.

import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { actorId } from '../../write/kernel/pelago-types.ts';
import { answerFilled } from './surface-slots.ts';

/** `rechecked`: the projects the recheck view says waited for one start again; answers which, and when. */
export async function rechecked(l: Archipelago, actor: Actor, input: { repo: string; summary?: string }) {
  // The re-check is a pack's to say (the recheck view): with no pack here that declares it, there is none.
  const asked = await answerFilled(l, 'view', { view: 'recheck', params: { repo: input.repo, limit: 0 } }).catch((err: Error) => {
    throw /^No view "recheck"/.test(err.message) ? new Error('No pack here keeps scheduled re-checks: rechecked needs one that declares the recheck view.') : err;
  });
  const projects = (asked as { projects: { id: string; title: string; waited: boolean }[] }).projects.filter((p) => p.waited);
  const at = new Date().toISOString();
  for (const p of projects) {
    // Bookkeeping stays out of the project's history; the re-check itself is the event.
    await l.operational(p.id, { props: { rechecked_at: at } }, { actor: actorId(actor), action: 'recheck.done', reason: input.summary ?? 'Scheduled re-check of the oldest open items' });
  }
  return { rechecked: projects.map((p) => ({ id: p.id, title: p.title })), at };
}
