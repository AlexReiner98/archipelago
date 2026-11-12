// What a session is told as it reads or changes a file (the hook's file-used event, after Read, Edit or Write): the
// instructions said for files whose globs name it, kept about the repository the session lives in or the whole
// workspace, less those it has been told already. The hook keeps which it has been told, in the checkout, and sends
// them back; the server keeps nothing. What is said where is the agents pack's, read as the reads API answers it.

import type { KernelContext } from '#pelago/kernel';
import { resolveRun } from './chat-run.ts';
import { placeOf } from './places.ts';

/** How an instruction's `for` names files (the agents pack's FILE). */
const FILE = 'file:';

/** What to tell a session about one file, and the instructions that tell it; nothing when there is nothing new. */
export async function fileSaid(ctx: KernelContext, input: { session_id?: string; path?: unknown; said?: unknown }): Promise<{ text: string; ids: string[] } | undefined> {
  if (typeof input.path !== 'string' || !input.path) return undefined;
  const before = new Set(Array.isArray(input.said) ? input.said.map(String) : []);
  const run = input.session_id ? await resolveRun(ctx, input.session_id, true) : undefined;
  const place = run ? await placeOf(ctx, run.id) : undefined;
  const all = (await ctx.reads({ instructions: { where: `${FILE}${input.path}`, ...(place && { about: place }) } })) as { id: string; title: string; text: string }[];
  const told = all.filter((one) => !before.has(one.id));
  if (!told.length) return undefined;
  return { text: [`Archipelago, on ${input.path}:`, ...told.map((one) => `- ${one.title}. ${one.text}`)].join('\n'), ids: told.map((one) => one.id) };
}
