// Where a session's place stood when it was last heard from, as its hook says it at each turn's end and at the end.
// What the facts are is the pack's whose place it is: the kernel keeps them as said, a small flat object, on the run as
// its stands field, by operational and in no stream, as its heartbeat is (the newest is all that matters). It reads
// one key of them itself, branch, to tell two sessions in one folder apart (src/chat-run.ts).

import type { Archipelago } from '../../../src/pelago.ts';
import { resolveRun } from './sessions.ts';

export type Stands = Record<string, string | number | boolean>;

const KEYS = 16;
const TEXT = 1000;
const fits = (v: unknown) => (typeof v === 'string' ? v.length <= TEXT : typeof v === 'number' ? Number.isFinite(v) : typeof v === 'boolean');

/** What a hook said of where its session stands, or undefined when it is not a small flat object of words, numbers and yes or no. */
export function standsOf(v: unknown): Stands | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length || entries.length > KEYS || !entries.every(([k, x]) => /^[a-z][a-z0-9_]{0,39}$/.test(k) && fits(x))) return undefined;
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : 1))) as Stands;
}

/** Keep where a session stands on its run, when the hook said it and it has moved since it was last kept. */
export async function keepStands(l: Archipelago, session: string | undefined, sent: unknown): Promise<void> {
  const stands = standsOf(sent);
  if (!stands || !session) return;
  const run = await resolveRun(l, session, true);
  if (!run || JSON.stringify(standsOf(run.props.stands)) === JSON.stringify(stands)) return;
  await l.operational(run.id, { props: { stands } });
}
