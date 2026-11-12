// What the server's configuration says, read from its words (./config.ts reads them from the environment and
// pelago.config.json): the packs it offers, those one workspace alone may have, and its policy on agents' changes.
// Pure, and the database root's, so the config is read without asking above it; the loader (pack-allow.ts) and
// identity (policy.ts) answer these as theirs.

import type { Level, OpKind, Policy } from '../../../src/rules.ts';

const list = (text: string) => text.split(',').map((p) => p.trim()).filter(Boolean);

/** The server's list of packs, read from PELAGO_ONLY_PACKS: unset or empty, every pack. */
export function readOnlyPacks(said: string | undefined): string[] | undefined {
  return said?.trim() ? list(said) : undefined;
}

/** The packs each workspace may have beyond the server's list, read from "ws=a,b;other=c". */
export function readWorkspacePacks(said: string | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const part of (said ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at < 0) {
      if (part.trim()) throw new Error(`PELAGO_WORKSPACE_PACKS: "${part.trim()}" names no workspace (workspace=pack,pack).`);
      continue;
    }
    const ws = part.slice(0, at).trim();
    if (!ws) throw new Error(`PELAGO_WORKSPACE_PACKS: "${part.trim()}" names no workspace (workspace=pack,pack).`);
    out[ws] = [...new Set([...(out[ws] ?? []), ...list(part.slice(at + 1))])];
  }
  return out;
}

/** Every op a policy speaks to, each once: the compiler holds this to rules' OpKind, no more and no fewer. */
const OPS: Record<OpKind, true> = { create: true, update: true, link: true, unlink: true, archive: true, restore: true, merge: true, define_type: true };

/** The server's policy as the config gives it: in dev mode every op applies without review, then what the file says. */
export function serverPolicy(given: Partial<Policy> | undefined, dev: boolean): Partial<Policy> | undefined {
  if (!dev) return given;
  const unreviewed = Object.fromEntries(Object.keys(OPS).map((op) => [op, 'auto' satisfies Level])) as Policy;
  return { ...unreviewed, ...given };
}
