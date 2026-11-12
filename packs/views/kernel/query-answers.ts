// What the views pack answers the query pack by name (pack.json, kernel.provides): what a lens on a time axis is filed
// by (timelanes.ts), its maps as objects by id, so a pipe could carry them.

import type { KernelContext } from '#pelago/kernel';
import { fileOnAxis, type Span } from './timelanes.ts';

type Input = { items: { id: string; type: string; title: string; owner: string | null }[]; spans: Record<string, Span[]>; me: string | null };

/** `answer.time_lanes`: each placed item's lane and stream, each span named and coloured, and the lanes and streams. */
export async function timeLanes(ctx: KernelContext, input: Input) {
  const { lane, stream, filed, lanes, streams } = await fileOnAxis(ctx, input.items, new Map(Object.entries(input.spans ?? {})), input.me ?? null);
  return { lane: Object.fromEntries(lane), stream: Object.fromEntries(stream), filed: Object.fromEntries(filed), lanes, streams };
}
