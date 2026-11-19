// Layer: graph. The one seam where how often each node was said comes in: the blue lights run to a node in proportion
// to it. A node's item carries its count as the field `said` once the reflex pack counts its sayings (task
// e_gs8x2u3n). Until any node in the answer carries one, the counts are schematic: older nodes said more, each by a
// share its id gives it, up to reflex_mock_said; `schematic` says so, and the key and the counts say it to the reader.

import { hash } from './tree.js';

/** { counts: Map of node id to times said, total, schematic }. A bough the tree made is never said itself. */
export function sayingsOf(tree, n) {
  const counted = (node) => Number(node.item?.fields?.said);
  const real = tree.written.some((node) => Number.isFinite(counted(node)));
  const counts = new Map();
  const most = n('reflex_mock_said');
  tree.written.forEach((node, i) => {
    const old = 1 - i / Math.max(1, tree.written.length);
    const c = real ? counted(node) : Math.round(most * old * old * (hash(`said:${node.id}`) + 0.25));
    counts.set(node.id, Number.isFinite(c) && c > 0 ? c : 0);
  });
  const total = [...counts.values()].reduce((s, c) => s + c, 0);
  return { counts, total, schematic: !real };
}

/**
 * The counts the reflex_view pack answers (its view said_counts, asked through the view's sends): one record per id,
 * { id, said, ... }. Each node with a record takes its count; one with none was never said. Changes `said` in place,
 * so the film and the lights read the counts as they are, and says whether any came.
 */
export function countedFrom(said, records) {
  const got = (Array.isArray(records) ? records : []).filter((r) => r && typeof r.id === 'string' && Number.isFinite(Number(r.said)));
  if (!got.length) return false;
  const by = new Map(got.map((r) => [r.id, Math.max(0, Number(r.said))]));
  for (const id of said.counts.keys()) said.counts.set(id, by.get(id) ?? 0);
  said.total = [...said.counts.values()].reduce((s, c) => s + c, 0);
  said.schematic = false;
  return true;
}
