// What agents settled that the owner has not confirmed: put to the owner by the next session they talk to.
import type { KernelContext } from '#pelago/kernel';

/** One question an agent settled, as the log keeps it (the read confirm, src/packreads-log.ts). */
export interface Settled { id: string; title: string; answer: string; settled: Date; seq: number; by: string; on: string; basis?: string }

/** What the next session tells the owner to do with them. */
export const HOW = 'Show the owner, in your reply, a line for each question settled on an agent’s own judgment, and ask them to confirm or correct; of those recorded on their own word, say how many there are and list them only if asked. When they have answered, call settle with action confirmed, its upto and what they said; change or reopen whatever they correct, on their authority.';

/**
 * Questions agents have settled since the owner last looked, or last answered
 * for them: each decision or hypothesis an agent closed, with what was chosen
 * and on what it rests. The owner mostly meets the map through an agent in
 * chat, so this is what the next session shows them, in one list, in place of
 * a notification for each.
 */
export async function toConfirm(ctx: KernelContext, input: { limit?: number } = {}) {
  const read = (await ctx.reads({ confirm: { limit: input.limit ?? 40 } })) as { count: number; on_agents_judgment: number; on_owners_word: number; upto: number; questions: Settled[] };
  return { ...read, how: HOW };
}
