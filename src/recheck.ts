// What `report rechecked` does: the scheduled re-check of a repository said done, so each project waiting for one
// starts its interval again. The surface keeps the action's words and verb (src/tool-acts.ts); this is its filling of
// the slot surface.act (src/surface-slots.ts), held by the kernel until the pack that keeps the recheck view takes it.

import { askView, canAsk } from './askview.ts';
import type { Actor, Archipelago } from './pelago.ts';
import { actorId } from './pelago-types.ts';

/** surface.act `rechecked`: the projects the recheck view says waited for one start again; answers which, and when. */
export async function rechecked(l: Archipelago, actor: Actor, input: { repo: string; summary?: string }) {
  // The re-check is a pack's to say (the recheck view): with no pack here that declares it, there is none.
  if (!canAsk(l, 'recheck')) throw new Error('No pack here keeps scheduled re-checks: rechecked needs one that declares the recheck view.');
  const projects = ((await askView(l, actor, 'recheck', { repo: input.repo, limit: 0 })) as { projects: { id: string; title: string; waited: boolean }[] }).projects.filter((p) => p.waited);
  const at = new Date().toISOString();
  for (const p of projects) {
    // Bookkeeping stays out of the project's history; the re-check itself is the event.
    await l.operational(p.id, { props: { rechecked_at: at } }, { actor: actorId(actor), action: 'recheck.done', reason: input.summary ?? 'Scheduled re-check of the oldest open items' });
  }
  return { rechecked: projects.map((p) => ({ id: p.id, title: p.title })), at };
}
