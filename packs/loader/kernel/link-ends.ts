// A link type's ends. Each end is a list of what may stand there: `*` for anything, a type (and every flavour of
// it), or a capability, written `has:<capability>`: any type that declares it, of whatever kind or none
// (`owned_by` goes from `has:owned`). A capability end is how the kernel's own links say their ends once types need
// no kind (decision e_w46v6jf9).

import { CAPABILITIES, type Capabilities } from './capabilities.ts';
import type { ResolvedType } from './packs.ts';

const HAS = 'has:';

/** What a style's on names for every type made for a reader (a type's deliverable), whatever pack declares it. */
export const DELIVERABLE = 'has:deliverable';

/** The capability an end names, if it names one. */
export const capabilityOf = (end: string): keyof Capabilities | undefined => (end.startsWith(HAS) ? (end.slice(HAS.length) as keyof Capabilities) : undefined);

/** Why an end names nothing the packs define, if it does not. */
export function unknownEnd(end: string, isType: (id: string) => boolean): string | undefined {
  if (end === '*') return undefined;
  const cap = capabilityOf(end);
  if (cap) return (CAPABILITIES as readonly string[]).includes(cap) ? undefined : `unknown capability "${cap}" (known: ${CAPABILITIES.join(', ')})`;
  return isType(end) ? undefined : `unknown type "${end}"`;
}

/** Whether a type stands where `allowed` (one entry of an end) allows: it is that type or a flavour of it, or it declares that capability. */
export function holds(allowed: string, type: Pick<ResolvedType, 'lineage' | 'capabilities'> | undefined): boolean {
  if (allowed === '*') return true;
  if (!type) return false;
  const cap = capabilityOf(allowed);
  return cap ? type.capabilities[cap] !== undefined : type.lineage.includes(allowed);
}

/** Whether an end a flavour of a link type names lies inside what its parent allows there. */
export function within(end: string, parentEnd: string[], type: (id: string) => ResolvedType | undefined): boolean {
  return parentEnd.some((a) => a === '*' || (end !== '*' && (capabilityOf(end) ? a === end : holds(a, type(end)))));
}
