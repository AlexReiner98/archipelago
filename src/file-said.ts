// What a session is told as it reads or changes a file (the hook's file-used event, after Read, Edit or Write): the
// instructions said for files whose globs name it, kept about the repository the session lives in or the whole
// workspace, less those it has been told already. The hook keeps which it has been told, in the checkout, and sends
// them back; the server keeps nothing.

import { FILE, instructionsFor } from './instructions.ts';
import { livesIn } from './places.ts';
import type { Archipelago } from './pelago.ts';
import { resolveRun } from './sessions.ts';

/** What to tell a session about one file, and the instructions that tell it; nothing when there is nothing new. */
export async function fileSaid(l: Archipelago, input: { session_id?: string; path?: unknown; said?: unknown }): Promise<{ text: string; ids: string[] } | undefined> {
  if (typeof input.path !== 'string' || !input.path) return undefined;
  const before = new Set(Array.isArray(input.said) ? input.said.map(String) : []);
  const run = input.session_id ? await resolveRun(l, input.session_id, true) : undefined;
  const { rows: [place] } = run ? await l.db.query<{ to_id: string }>(`select to_id from relation where from_id = $1 and type = any($2::text[]) and valid_to is null limit 1`, [run.id, livesIn(l)]) : { rows: [] };
  const told = (await instructionsFor(l, `${FILE}${input.path}`, { ...(place && { about: place.to_id }) })).filter((one) => !before.has(one.id));
  if (!told.length) return undefined;
  return { text: [`Archipelago, on ${input.path}:`, ...told.map((one) => `- ${one.title}. ${one.text}`)].join('\n'), ids: told.map((one) => one.id) };
}
