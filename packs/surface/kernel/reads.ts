// Reads asked together, answered in one request (`/api/reads`, task e_bmh2braj): the page sends the reads it asks in
// the same moment as one list (packs/kit/page/reads.js), and each is answered here as it would be alone, through the
// same tool and as the same person, so nothing is read that one call would not read. Only reads: a write goes alone,
// under its own name, where its answer and refusal are its own. Under a look's pass, only what a look reads.
//
// A read whose answer moves only with the map (KEEPS) is answered with where the map stood (`at`,
// packs/log/kernel/position.ts), and the page keeps it; asked again with that (`since`) while the map stands there, it
// is answered `unchanged` without being read (task e_mvuvfba7).

import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { LOOK_READS } from '../../walls/kernel/look-pass.ts';
import { standsAt } from '../../log/kernel/position.ts';
import { stood, unchanged } from '../../../src/timing.ts';
import { callTool } from './tools.ts';

/** The reads that may come together: the page's list (packs/kit/page/reads.js, TOGETHER), and none of them writes; a pack's views too. */
export const TOGETHER = new Set(['get', 'events', 'proposals', 'view', 'search', 'share_list', 'workspace_info', 'published', 'publish_plan', 'picture', 'schema', 'packs']);
/**
 * The reads whose answer moves only with where the map stands (packs/log/kernel/position.ts): the page's list too
 * (packs/kit/page/reads.js, KEEPS). A view by its name. Not a canvas's query, whose answer the page keeps current itself.
 */
export const KEEPS = new Set(['proposals', 'workspace_info', 'share_list']);
export const KEEPS_VIEWS = new Set(['saved_views', 'style', 'parts', 'shared', 'instructions']);
/** The kept reads of what is shared, which is kept beside the map and moves apart from it. */
const OF_SHARED = (tool: string, input: unknown) => tool === 'share_list' || (tool === 'view' && (input as { name?: unknown } | null)?.name === 'shared');
/** How many reads one request may carry. */
export const MOST_TOGETHER = 40;

type Asked = { tool?: unknown; input?: unknown; since?: unknown };
type Answer = { result: unknown; at?: string } | { unchanged: true } | { error: string };

/** Whether a read's answer is kept by where the map stands. */
export const keeps = (tool: string, input: unknown) => KEEPS.has(tool) || (tool === 'view' && KEEPS_VIEWS.has(String((input as { name?: unknown } | null)?.name)));

/** Each read answered as it would be alone, in the order asked; one refused or failing is said, the rest answered. */
export async function readsTogether(l: Archipelago, actor: () => Actor, body: { calls?: unknown }, look = false): Promise<Answer[]> {
  const calls = body?.calls;
  if (!Array.isArray(calls) || !calls.length) throw new Error('reads takes calls: a list of { tool, input }.');
  if (calls.length > MOST_TOGETHER) throw new Error(`reads takes at most ${MOST_TOGETHER} calls at once.`);
  const asked = calls as Asked[];
  // Where the map stands, read before any read it stamps, once for the request.
  const who = actor();
  const reader = [who.kind, who.person ?? who.name, who.admin ? 'admin' : '', who.token ?? ''].join('/');
  const kept = asked.filter(({ tool, input }) => keeps(String(tool), input));
  const stands = kept.length ? await stood(() => standsAt(l.db, reader, kept.some(({ tool, input }) => OF_SHARED(String(tool), input)))) : undefined;
  return Promise.all(
    asked.map(async ({ tool, input, since }): Promise<Answer> => {
      const name = String(tool);
      if (!TOGETHER.has(name) && l.registry.tools.get(name)?.call !== 'view') return { error: `Only reads go together; send ${name} on its own.` };
      if (look && !LOOK_READS.has(name)) return { error: `A look reads; it does not call ${name}.` };
      const at = stands && keeps(name, input) ? (OF_SHARED(name, input) ? stands.shared : stands.map) : undefined;
      if (at !== undefined && since === at) return (unchanged(), { unchanged: true });
      try {
        const result = await callTool(l, who, name, input ?? {});
        return at !== undefined ? { result, at } : { result };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }),
  );
}
