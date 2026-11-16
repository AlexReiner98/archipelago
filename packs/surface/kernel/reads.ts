// Reads asked together, answered in one request (`/api/reads`, task e_bmh2braj): the page sends the reads it asks in
// the same moment as one list (packs/kit/page/reads.js), and each is answered here as it would be alone, through the
// same tool and as the same person, so nothing is read that one call would not read. Only reads: a write goes alone,
// under its own name, where its answer and refusal are its own. Under a look's pass, only what a look reads.

import type { Actor, Archipelago } from '../../write/kernel/pelago.ts';
import { LOOK_READS } from '../../walls/kernel/look-pass.ts';
import { callTool } from './tools.ts';

/** The reads that may come together: the page's list (packs/kit/page/reads.js, TOGETHER), and none of them writes; a pack's views too. */
export const TOGETHER = new Set(['get', 'events', 'proposals', 'view', 'search', 'share_list', 'workspace_info', 'published', 'publish_plan', 'picture', 'schema', 'packs']);
/** How many reads one request may carry. */
export const MOST_TOGETHER = 40;

type Asked = { tool?: unknown; input?: unknown };
type Answer = { result: unknown } | { error: string };

/** Each read answered as it would be alone, in the order asked; one refused or failing is said, the rest answered. */
export async function readsTogether(l: Archipelago, actor: () => Actor, body: { calls?: unknown }, look = false): Promise<Answer[]> {
  const calls = body?.calls;
  if (!Array.isArray(calls) || !calls.length) throw new Error('reads takes calls: a list of { tool, input }.');
  if (calls.length > MOST_TOGETHER) throw new Error(`reads takes at most ${MOST_TOGETHER} calls at once.`);
  return Promise.all(
    (calls as Asked[]).map(async ({ tool, input }): Promise<Answer> => {
      const name = String(tool);
      if (!TOGETHER.has(name) && l.registry.tools.get(name)?.call !== 'view') return { error: `Only reads go together; send ${name} on its own.` };
      if (look && !LOOK_READS.has(name)) return { error: `A look reads; it does not call ${name}.` };
      try {
        return { result: await callTool(l, actor(), name, input ?? {}) };
      } catch (err) {
        return { error: (err as Error).message };
      }
    }),
  );
}
