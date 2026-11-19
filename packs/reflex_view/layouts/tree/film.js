// Layer: shape. When each thing happens as the tree is played: over real dates. The story's window (./story.js) runs
// over reflex_film seconds after the root stands alone (reflex_film_lead). Core's and the packs' presets, and what was
// made before the window, stand from the start: the trunk. Each node made in the window comes in on its day. Each miss
// sparks on its day, where it happened (the trial node written from it, else the bough of its place, else the root);
// each saying runs a light to its node on its day, held or came back; a quiet one runs none.

import { boughsOf } from './tree.js';

/** The film of a tree and its story: when each node is born, the events in order, and the date at a time. */
export function filmOf(tree, story, n) {
  const lead = n('reflex_film_lead'), length = n('reflex_film'), span = Math.max(1, story.to - story.from);
  const time = (at) => lead + Math.max(0, Math.min(1, (at - story.from) / span)) * length;
  const end = lead + length;
  // A node stands from the start if it is core's or a pack's, or was made before the window.
  const born = new Map([[tree.root.id, 0]]);
  for (const node of tree.born) {
    const tier = story.nodes.get(node.id)?.tier;
    born.set(node.id, tier === 'core' || tier === 'pack' || !(node.born > story.from) ? 0 : time(node.born));
  }
  // Where a miss happened: the deepest bough of its place the tree has.
  const placeOf = (where) => {
    let at = tree.root;
    for (const b of boughsOf(where, n('reflex_file_depth'), n('reflex_place_depth'))) at = tree.nodes.get(`~for:${b.key}`) ?? at;
    return at;
  };
  const events = [
    ...story.misses.map((m) => ({ kind: 'miss', t: time(m.at), node: (m.grew && tree.nodes.get(m.grew)) || placeOf(m.where), grew: Boolean(m.grew && tree.nodes.get(m.grew)) })),
    ...story.said.filter((s) => s.verdict !== 'quiet' && tree.nodes.has(s.id)).map((s) => ({ kind: s.verdict === 'failed' || s.verdict === 'came_back' ? 'failed' : 'held', t: time(s.at), node: tree.nodes.get(s.id) })),
  ].sort((a, b) => a.t - b.t);
  // A miss that grew a node is that node's birth.
  for (const e of events) if (e.kind === 'miss' && e.grew) born.set(e.node.id, e.t);
  // A bough stands when its first node does.
  const first = (node) => (node.kids.length ? Math.min(born.get(node.id), ...node.kids.map(first)) : born.get(node.id));
  for (const node of tree.order) if (node.parent && !node.item && !node.preset) born.set(node.id, first(node));
  const dateAt = (t) => story.from + (Math.max(0, Math.min(length, t - lead)) / length) * span;
  return { born, end, events, dateAt };
}
