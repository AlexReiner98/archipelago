// Install and upgrade as changes: a pack file's manifest and the map's items of that pack in, ops out. Pure: it reads
// nothing and writes nothing, so the handler and the tests hand it the same two things.
//
// Install makes every part an item, part of its pack's item, carrying what was shipped. An upgrade merges each field
// against what was last shipped of it: only the pack changed it, it is applied; only the owner did, theirs is kept;
// both did, theirs is kept and the pack's value goes to the owner as a change of its own, which the pack's rule
// both_changed holds and the page draws as a ghost. A part the new version drops is retired, not deleted, unless the
// owner changed it. Everything but those offers is one change set, so one undo takes the install or upgrade back.

import { canonical, createOp, flat, onMap, openStatus, RETIRED, SHIPPED, MERGE_MARK, shipped, stampOf, unflat, updateOp } from './shape.js';

const same = (a, b) => canonical(a === undefined ? null : a) === canonical(b === undefined ? null : b);

/**
 * What installing or upgrading to this manifest comes to on a map that holds these items of its pack (its item and
 * its parts, retired ones too). runs: the code files of the pack and its parts, { pack: [{ path, hash }], '<key>': [...] },
 * when the caller read them.
 * Answers { ops, reason, changes: [{ ops, reason }] (each an offer held for the owner), summary }.
 */
export function plan(manifest, items = [], runs = {}) {
  const ship = shipped(manifest);
  const onmap = items.map(onMap).filter((i) => i.key);
  const byKey = new Map(onmap.map((i) => [i.key, i]));
  const packItem = byKey.get(ship.pack.key);
  const from = packItem ? String(packItem.stamp?.version ?? packItem.fields.version ?? '?') : undefined;
  const reason = !packItem ? `Install ${ship.id} ${ship.version}` : from === ship.version ? `Reinstall ${ship.id} ${ship.version}` : `Upgrade ${ship.id} ${from} → ${ship.version}`;
  const ops = [], changes = [];
  const summary = { pack: ship.id, from: from ?? null, to: ship.version, made: [], applied: [], kept: [], asked: [], retired: [], left: [] };
  const runsOf = (key) => (Array.isArray(runs[key]) ? { runs: runs[key] } : {});

  const merged = (item, part, runKey) => {
    const m = mergeOne(item, part);
    const stamp = stampOf(ship, part);
    const back = item.status === RETIRED && item.stamp?.dropped ? { status: openStatus(item.type) } : {};
    const extra = { ...(!same(item.stamp, stamp) && { [SHIPPED]: stamp }), ...runsOf(runKey) };
    const apply = unflat(item, m.apply);
    if (Object.keys(apply).length || back.status || Object.keys(extra).length) ops.push({ ...updateOp(item.id, apply, extra), ...back });
    if (Object.keys(m.apply).length) summary.applied.push({ key: part.key, fields: Object.keys(m.apply) });
    if (m.kept.length) summary.kept.push({ key: part.key, fields: m.kept });
    if (Object.keys(m.asked).length) {
      // The offer is written over the item as the change before it leaves it, so taking it keeps what that applied.
      const after = { ...item, fields: { ...item.fields, ...apply } };
      summary.asked.push({ key: part.key, fields: Object.keys(m.asked) });
      changes.push({
        ops: [updateOp(item.id, unflat(after, m.asked), { [MERGE_MARK]: 'both' })],
        reason: `${reason}: you and the pack both changed "${item.title}" (${Object.keys(m.asked).join(', ')}); yours stands unless you take the pack's`,
      });
    }
  };

  let packRef;
  if (packItem) {
    packRef = packItem.id;
    merged(packItem, ship.pack, 'pack');
  } else {
    packRef = 'pack';
    ops.push(createOp(ship, ship.pack, packRef, runsOf('pack')));
    summary.made.push(ship.pack.key);
  }

  ship.parts.forEach((part, i) => {
    const item = byKey.get(part.key);
    if (item) return merged(item, part, part.key);
    const ref = `part${i}`;
    ops.push(createOp(ship, part, ref, runsOf(part.key)), { op: 'link', type: 'part_of', from: ref, to: packRef });
    summary.made.push(part.key);
  });

  // What this pack shipped before and ships no more: retired, unless the owner made it theirs.
  const now = new Set(ship.parts.map((p) => p.key));
  for (const item of onmap) {
    if (item === packItem || now.has(item.key) || item.pack !== ship.id || item.status === RETIRED) continue;
    const changed = ownerChanged(item);
    if (changed.length) {
      summary.left.push({ key: item.key, fields: changed });
      continue;
    }
    ops.push({ op: 'update', id: item.id, status: RETIRED, props: { [SHIPPED]: { ...item.stamp, dropped: ship.version } } });
    summary.retired.push(item.key);
  }

  return { ops, reason, changes, summary };
}

/** The fields the owner has changed since the pack last shipped them: all, when it never was. */
function ownerChanged(item) {
  const now = flat(item);
  if (!item.base) return Object.keys(now);
  const base = flat(item.base);
  return [...new Set([...Object.keys(base), ...Object.keys(now)])].filter((f) => !same(now[f], base[f]));
}

/**
 * One item against what the pack ships of it now, field by field, against what it was last shipped as: apply what
 * only the pack changed, keep what only the owner changed, offer the owner the pack's where both did. An item never
 * shipped (no shipped.value) is taken to have been changed by both wherever it differs.
 * Answers { apply, asked, kept }, apply and asked by flat field (flat in shape.js), null for a field taken away.
 */
export function mergeOne(item, part) {
  const now = flat(item), next = flat(part), base = item.base ? flat(item.base) : undefined;
  const apply = {}, asked = {}, kept = [];
  for (const f of new Set([...Object.keys(next), ...Object.keys(base ?? {})])) {
    const want = next[f] === undefined ? null : next[f];
    if (same(now[f], want)) continue;
    if (base && same(now[f], base[f])) apply[f] = want;
    else if (base && same(want, base[f])) kept.push(f);
    else asked[f] = want;
  }
  return { apply, asked, kept };
}
