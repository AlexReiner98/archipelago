// The read said_schema (surface's slot surface.reads): every type and the checks it implies, each check with when it
// refused lately. Bounded: the registry, and the refusals the misses read gives for the window (runs seen in it, a
// limit). schema.ts decides.

import type { KernelContext } from '#pelago/kernel';
import { misses } from './misses-read.ts';
import { schemaNodes, withFired, type LinkDecl, type SchemaNode, type TypeDecl } from './schema.ts';

const DAYS = 30;
const DAYS_MOST = 90;

/** The types and link types in force here, as schema.ts reads them: retired and dormant ones left out. */
export function declared(ctx: KernelContext): { types: TypeDecl[]; links: LinkDecl[] } {
  const types = [...ctx.registry.types.values()].filter((t) => !t.retired && !t.dormant) as unknown as TypeDecl[];
  const links = [...ctx.registry.relations.values()].filter((r) => !(r as { retired?: boolean }).retired) as unknown as LinkDecl[];
  return { types, links };
}

/** Every type and its checks, each check with its refusals in the last days (at most DAYS_MOST). */
export async function schemaOf(ctx: KernelContext, days: number): Promise<SchemaNode[]> {
  const { types, links } = declared(ctx);
  const refused = (await misses(ctx, { misses: { days } })).filter((m) => m.kind === 'refusal');
  return withFired(schemaNodes(types, links), refused);
}

/** `said_schema: { days? }`: the schema as nodes, for the tree. */
export const said_schema = (ctx: KernelContext, q: { said_schema: { days?: unknown } }) =>
  schemaOf(ctx, Math.min(DAYS_MOST, Math.max(1, Number(q.said_schema?.days ?? DAYS) || DAYS)));

