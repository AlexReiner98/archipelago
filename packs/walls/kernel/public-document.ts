// A document anyone may read, with no login, at an address of its own that search engines may keep:
// /p/<workspace>/<id>, beside a product's public page. Only a human makes it public: the core pack holds an agent's
// change to public, as for anything public. Which types a document is read whole as and may be public is the walls',
// and the headers every public answer carries; it is read through one function that sees everything and gives as
// little as it can (the surface's packs/surface/kernel/public-documents.ts).

import type { Archipelago } from '../../../src/pelago.ts';

/**
 * The types a document is read whole as and can be public: a flavour that cannot be (an invoice) is left out.
 */
export const readable = (l: Archipelago) => l.registry.drawnWith('document').filter((t) => l.registry.type(t)?.public);

/** Of those, each closed status that says its writing is done (phase finished), as type:status: still published with the open ones. */
export const finishedStatuses = (l: Archipelago) =>
  readable(l).flatMap((t) => Object.entries(l.registry.type(t)?.statuses.phases ?? {}).filter(([, p]) => p === 'finished').map(([s]) => `${t}:${s}`));

/** What every public page and its data are sent with, and a public page's content policies, defined once with the others (src/page-policies.ts). */
export { GUARD, PUBLIC_POLICY as POLICY, READER_POLICY } from './page-policies.ts';
