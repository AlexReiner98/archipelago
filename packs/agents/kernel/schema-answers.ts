// What the surface's schema read asks of this pack (docs/kernel-packs.md, "Service names"): the model as an agent is
// given it unless it asks for more (answer.schema_brief), and one type, link type or pack whole out of the registry's
// description (answer.schema_of). Answered as the map that asks: an island's version reads its own registry.

import type { KernelContext } from '#pelago/kernel';
import { schemaBrief, schemaOf } from './schema-brief.ts';

type Described = Parameters<typeof schemaOf>[0];

/** answer.schema_brief: each type and link type on a line. */
export const brief = (ctx: KernelContext) => schemaBrief(ctx.registry);

/** answer.schema_of: one type, link type or pack, whole. */
export const one = (_ctx: KernelContext, input: { described: Described; type: string }) => schemaOf(input.described, input.type);
