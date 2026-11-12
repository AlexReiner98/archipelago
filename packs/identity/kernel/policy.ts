// The server's policy on agents' changes (pelago.config.json `policy`): the half of the server's configuration that says
// who may change what unasked, split from the database root's config (docs/kernel-packs.md, "Where each module goes").
// Dev mode lifts review of every op unless the file says otherwise. The ops are named here by type alone, so this
// imports nothing above identity: a new op in rules' OpKind fails the typecheck until it is named below.

import type { Level, OpKind, Policy } from '../../../src/rules.ts';

/** Every op a policy speaks to, each once: the compiler holds this to rules' OpKind, no more and no fewer. */
const OPS: Record<OpKind, true> = { create: true, update: true, link: true, unlink: true, archive: true, restore: true, merge: true, define_type: true };

/** The server's policy as the config gives it: in dev mode every op applies without review, then what the file says. */
export function serverPolicy(given: Partial<Policy> | undefined, dev: boolean): Partial<Policy> | undefined {
  if (!dev) return given;
  const unreviewed = Object.fromEntries(Object.keys(OPS).map((op) => [op, 'auto' satisfies Level])) as Policy;
  return { ...unreviewed, ...given };
}
