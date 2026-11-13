// A part's new version tried on one island before review (task e_g4jpb7ps, decision e_6f2kje39): what the rules read
// of each op of a change before they judge it. A version of a map pack whose code is its parts' modules alone runs
// only in the browser, walled in a worker, and only on the islands that pin it (packs/loader/kernel/island-pin.ts):
// written while one island at most pins it, it is a trial (part_trial), which core's rule part_trial lets through its
// code rules. Pinning such a version on another island spreads it (spreads), which core's version_spread holds for
// the owner. What becomes of the op is decide's alone (packs/rules/kernel/rules.ts): this only reads the facts.

import { ISLAND } from './island-items.ts';
import { mapPack, PACK_VERSION } from './island-pin.ts';
import { codeTexts } from './pack-code.ts';
import { PACK_ITEM } from './pack-items.ts';
import type { Registry } from './packs.ts';
import { partsOf } from './ui-parts.ts';
import type { Q } from '../../database/kernel/db.ts';
import type { OpFacts, Target } from '../../rules/kernel/rules.ts';

type OpLike = { op: string; id?: string; type?: string; props?: Record<string, unknown> } & Record<string, unknown>;

/** The type an item kept as a pack is of, and the fields of a version an op may set while it stays a trial. */
const PACK = PACK_ITEM;
const TRIAL_FIELDS = new Set(['code']);
const TRIAL_HEAD = new Set(['op', 'id', 'ref', 'type', 'title', 'body', 'append', 'replace', 'props']);

/** The files of a map pack that are its parts' modules alone: named by a part, by nothing else it declares, and imported by none of its other code. */
export function partFiles(reg: Registry, pack: string): Set<string> {
  const m = reg.found.find((p) => p.id === pack);
  if (!m || !mapPack(reg, pack)) return new Set();
  const files = new Set(partsOf([m]).flatMap((p) => Object.values(p.modules ?? {})));
  const elsewhere = JSON.stringify({ ...m, parts: undefined });
  let others: string[] = [];
  try {
    const texts = codeTexts(reg.folderOf(pack));
    others = Object.entries(texts).filter(([path]) => !files.has(path)).map(([, text]) => text);
  } catch { /* a pack with no folder has no other code */ }
  return new Set([...files].filter((f) => f !== 'handler.js' && !elsewhere.includes(f) && !others.some((t) => t.includes(f))));
}

/** Whether a version's code is its pack's part modules alone. */
function partCodeAlone(reg: Registry, of: unknown, code: unknown): boolean {
  if (typeof of !== 'string' || !code || typeof code !== 'object' || Array.isArray(code)) return false;
  const paths = Object.keys(code);
  const files = partFiles(reg, of);
  return paths.length > 0 && paths.every((p) => files.has(p));
}

/** How many open islands pin each of these versions. */
async function pins(q: Q, reg: Registry, versions: string[]): Promise<Map<string, number>> {
  if (!versions.length) return new Map();
  const { rows } = await q.query<{ v: string; n: number }>(
    `select props->>'${PACK_VERSION}' as v, count(*)::int as n from entity where type = any($1::text[]) and archived_at is null and props->>'${PACK_VERSION}' = any($2::text[]) group by 1 -- index entity_type`,
    [reg.family(ISLAND), versions],
  );
  return new Map(rows.map((r) => [r.v, Number(r.n)]));
}

/**
 * For each op, what the rules read of it beside the op: whether it writes a trial's part code (part_trial), and whether
 * it pins a version carrying code that another island already pins (spreads). `found` is the items the ops name, as
 * they are before the change.
 */
export async function opFacts(q: Q, reg: Registry, ops: { op: string }[], found: Map<string, Target>): Promise<OpFacts[]> {
  const given = ops as OpLike[];
  if (!reg.types.has(PACK) || !reg.types.has(ISLAND)) return given.map(() => ({}));
  const isPack = (type: string | undefined) => Boolean(type && reg.isA(type, PACK));
  const isIsland = (type: string | undefined) => Boolean(type && reg.isA(type, ISLAND));
  const asked = new Set<string>();
  for (const op of given) {
    const target = op.id ? found.get(op.id) : undefined;
    if (op.op === 'update' && target && isPack(target.type)) asked.add(target.id);
    const pinned = op.props?.[PACK_VERSION];
    if ((op.op === 'create' || op.op === 'update') && typeof pinned === 'string' && isIsland(op.op === 'create' ? op.type : target?.type)) asked.add(pinned);
  }
  const counted = await pins(q, reg, [...asked]);
  return given.map((op) => {
    const target = op.id ? found.get(op.id) : undefined;
    const type = op.op === 'create' ? op.type : target?.type;
    const facts: OpFacts = {};
    if ((op.op === 'create' || op.op === 'update') && isPack(type)) {
      const props = { ...target?.props, ...op.props };
      const only = Object.keys(op).every((k) => TRIAL_HEAD.has(k)) && Object.keys(op.props ?? {}).every((k) => op.op === 'create' || TRIAL_FIELDS.has(k));
      const pinnedOn = op.op === 'create' ? 0 : (counted.get(target!.id) ?? 0);
      facts.part_trial = only && pinnedOn <= 1 && partCodeAlone(reg, props.version_of, props.code);
    }
    const pinned = op.props?.[PACK_VERSION];
    if ((op.op === 'create' || op.op === 'update') && isIsland(type) && typeof pinned === 'string' && target?.props?.[PACK_VERSION] !== pinned) {
      const version = reg.versions.get(pinned);
      facts.spreads = Boolean(version?.code && Object.keys(version.code).length) && (counted.get(pinned) ?? 0) >= 1;
    }
    return facts;
  });
}
