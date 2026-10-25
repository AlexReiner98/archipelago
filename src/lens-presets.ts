// Standing views a pack declares as data (a view with `lens` in its pack.json), each answered by its own read, in
// the form it has always had: the flat lens (src/lens-flat.ts), the graph (src/view-graph.ts), the tree
// (src/view-tree.ts), the hubs, attention and the brief. The old lens (src/lens.ts) answers `lens` alone, for the
// page, until the page reads the flat lens.

import { attention, type Input } from './attention.ts';
import { brief, briefRead } from './brief.ts';
import type { LENS_ANSWERS, ViewDef } from './declared.ts';
import { HUB_AT, hubs } from './lens-kept.ts';
import { lens } from './lens.ts';
import { flatLens } from './lens-flat.ts';
import type { Archipelago } from './pelago.ts';
import { graph } from './view-graph.ts';
import { tree } from './view-tree.ts';

type Reading = (l: Archipelago, def: ViewDef, params: Record<string, unknown>) => Promise<unknown>;

/** The hubs (src/lens-kept.ts), with the size at which an item counts as one where its project does not say. */
const hubsOf: Reading = async (l, _def, params) => ({ at: HUB_AT, within: params.within ?? null, hubs: await hubs(l, params.within === undefined ? undefined : String(params.within)) });

/**
 * What deserves attention: what is the person's, or inside what it is asked within, weighed by its reasons
 * (src/attention.ts). Every lens item's needs_you is read from the same reasons.
 */
const attend: Reading = async (l, _def, params) => attention(l, params as Input);

/** Everything a session needs to start on a task: what is read around the task by the links the preset names, with what holds the task and what it needs. */
const briefOf: Reading = async (l, def, params) => {
  if (!params.task) throw new Error('brief needs "task": the id of the entity to work on');
  const read = await briefRead(l, String(params.task), (def.lens?.over as string[] | undefined) ?? []);
  return brief(l, { task: String(params.task) }, read);
};

const READINGS: Record<(typeof LENS_ANSWERS)[number], Reading> = {
  lens: (l, def, params) => lens(l, { ...def.lens, ...params }),
  flat: (l, _def, params) => flatLens(l, params),
  graph,
  tree: (l, _def, params) => tree(l, params),
  hubs: hubsOf,
  attention: attend,
  brief: briefOf,
};

/** Answer a standing view a pack declares as data: read as its answer says. */
export function answerPreset(l: Archipelago, def: ViewDef, params: Record<string, unknown>): Promise<unknown> {
  return READINGS[(def.answer ?? 'lens') as keyof typeof READINGS](l, def, params);
}
