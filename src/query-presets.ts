// Standing views a pack declares as data (a view with `lens` in its pack.json), each answered by its own read, in
// the form it has always had: the flat lens (src/query-flat.ts), the hubs and the frontier. Any other answer is the
// service answer.<name> a pack provides (src/services.ts), asked with the view's params and answering for itself:
// the graph, the tree and the brief (packs/views), attention (packs/attention).

import type { LENS_ANSWERS, ViewDef } from './declared.ts';
import type { FrontierInput } from './frontier.ts';
import { HUB_AT, hubs } from './query-kept.ts';
import { callAs } from './kernel-context.ts';
import { flatRead } from './query-flat.ts';
import type { Archipelago } from './pelago.ts';

type Reading = (l: Archipelago, def: ViewDef, params: Record<string, unknown>) => Promise<unknown>;

/** The hubs (src/query-kept.ts), with the size at which an item counts as one where its project does not say. */
const hubsOf: Reading = async (l, _def, params) => ({ at: HUB_AT, within: params.within ?? null, hubs: await hubs(l, params.within === undefined ? undefined : String(params.within)) });

/** Where a session stands, and what there needs it (src/frontier.ts). */
const frontierOf: Reading = async (l, _def, params) => (await import('./frontier.ts')).frontier(l, params as FrontierInput);

const READINGS: Record<(typeof LENS_ANSWERS)[number], Reading> = {
  flat: (l, _def, params) => flatRead(l, params),
  hubs: hubsOf,
  frontier: frontierOf,
};

/** Answer a standing view a pack declares as data: read as its answer says, by the kernel or by the pack that provides it. */
export function answerPreset(l: Archipelago, def: ViewDef, params: Record<string, unknown>): Promise<unknown> {
  const answer = def.answer ?? 'flat';
  if (Object.hasOwn(READINGS, answer)) return READINGS[answer as keyof typeof READINGS](l, def, params);
  // As the map that asks (a person's view): the provider reads as they do (src/kernel-context.ts, callAs).
  return callAs(l, `answer.${answer}`, { ...params, ...(def.lens && { lens: def.lens }), ...(def.choices && { choices: def.choices }) });
}
