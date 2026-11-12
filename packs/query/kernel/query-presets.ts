// Standing views a pack declares as data (a view with `lens` in its pack.json), each answered by its own read, in
// the form it has always had: the flat lens (./query-flat.ts) and the hubs (the lenses pack's answer.hubs_of). Any
// other answer is the service answer.<name> a pack provides, asked with the view's params and answering for itself:
// the graph, the tree and the brief (packs/views), attention (packs/attention). The query pack may call the whole
// family (kernel.families): a view names its answer.

import type { KernelContext } from '#pelago/kernel';
import { flatRead } from './query-flat.ts';

/** A view a pack declares, as far as a preset reads it. */
export interface PresetDef { id: string; lens?: object; answer?: string; choices?: object }

type Reading = (ctx: KernelContext, def: PresetDef, params: Record<string, unknown>) => Promise<unknown>;

/** The hubs (the lenses pack's), with the size at which an item counts as one where its project does not say. */
const hubsOf: Reading = async (ctx, _def, params) => {
  const { at, hubs } = await ctx.call<unknown, { at: number; hubs: unknown[] }>('answer.hubs_of', params.within === undefined ? {} : { within: String(params.within) });
  return { at, within: params.within ?? null, hubs };
};

// The flat lens stays read here for a view that names it (core.flat); a pack asks for it by name, answer.flat (./answers.ts).
const READINGS: Record<'hubs' | 'flat', Reading> = {
  flat: (ctx, _def, params) => flatRead(ctx, params),
  hubs: hubsOf,
};

/** Answer a standing view a pack declares as data: read as its answer says, by the kernel or by the pack that provides it. */
export function answerPreset(ctx: KernelContext, def: PresetDef, params: Record<string, unknown>): Promise<unknown> {
  const answer = def.answer ?? 'flat';
  if (Object.hasOwn(READINGS, answer)) return READINGS[answer as keyof typeof READINGS](ctx, def, params);
  // As the map that asks (a person's view): the provider reads as they do.
  return ctx.call(`answer.${answer}`, { ...params, ...(def.lens && { lens: def.lens }), ...(def.choices && { choices: def.choices }) });
}
