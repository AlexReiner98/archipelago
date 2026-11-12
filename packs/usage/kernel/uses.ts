// How much each thing a pack declares is used on a workspace, counted as it happens: a view asked, an instruction
// said, a rule that held, refused or asked. Only how many, per thing per day, never by whom: held in memory and written
// each minute to the kernel's uses stream as counts are (src/pack-counts.ts), kept five weeks (core's rule uses).
// The Packs screen reads the last 30 days of it beside each declaration (src/pack-use.ts).

import { addCount } from '../../../src/pack-counts.ts';

/** The stream the uses are kept in. */
export const USES = 'uses';

/** What a use is of: a view asked, an instruction said, a rule that held, refused or asked an agent. */
export type UseKind = 'view' | 'told' | 'held' | 'refused' | 'asked';

/** A use's key in the stream: its kind and the declaration's id (a rule's as pack.rule). */
export const useKey = (kind: UseKind, id: string) => `${kind}:${id}`;

/** Count one use of a declaration on a workspace. */
export function used(workspace: string, kind: UseKind, id: string, n = 1) {
  if (id) addCount(workspace, USES, useKey(kind, id.replace(/\s/g, '_')), undefined, n);
}
