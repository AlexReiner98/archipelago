// Layer: shape. When each thing happens as the tree is played. The tree grows from the root alone (reflex_film_lead
// seconds) to the whole over reflex_film seconds, its nodes in the order they were made, the rate of new ones rising,
// peaking and falling, as new things are many at first and fewer as the tree covers more. The lights run more often
// the more of the tree is written: in proportion to the square of what is written so far (a tree that covers more of
// what happens answers more of it), from reflex_lights_least to reflex_lights_most a second; once grown, at
// reflex_lights_live. Each runs to a node made a while before (reflex_light_after), chosen by how often it was said.

/** A number generator from a seed, the same run each time: each call a number from 0 to 1. */
export const seeded = (seed) => {
  let s = Math.max(1, Math.floor(seed * 2147483646));
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
};

/** The film of a tree: when each node is born, how much is written and said by a time, and where the next light goes. */
export function filmOf(tree, said, n) {
  const lead = n('reflex_film_lead'), length = n('reflex_film');
  const born = new Map([[tree.root.id, 0]]);
  const k = tree.born.length;
  tree.born.forEach((node, i) => born.set(node.id, lead + (length * Math.acos(1 - (2 * (i + 1)) / k)) / Math.PI));
  const end = lead + length;
  const written = tree.written.map((node) => born.get(node.id));
  const writtenAt = (t) => written.filter((b) => b <= t).length;
  // How much of what the tree said is said by a time: the lights' rate summed, so the count runs as they do.
  const steps = Math.max(1, Math.ceil(end * n('reflex_count_steps')));
  const sum = [0];
  for (let i = 1; i <= steps; i++) sum.push(sum[i - 1] + writtenAt((i * end) / steps) ** 2);
  const saidAt = (t) => (t >= end || sum[steps] === 0 ? said.total : Math.round((said.total * sum[Math.max(0, Math.floor((t / end) * steps))]) / sum[steps]));
  const all = Math.max(1, tree.written.length);
  const rate = (t) => (t >= end ? n('reflex_lights_live') : Math.min(n('reflex_lights_most'), n('reflex_lights_least') + (n('reflex_lights_most') * writtenAt(t) ** 2) / all ** 2));
  const after = n('reflex_light_after');
  /** The node the next light runs to at `t`, weighed by how often each was said; null while none is old enough. */
  const pick = (t, rnd) => {
    const ready = tree.written.filter((node) => born.get(node.id) <= t - after);
    if (!ready.length) return null;
    const weigh = (node) => said.counts.get(node.id) + 1;
    let at = rnd() * ready.reduce((s, node) => s + weigh(node), 0);
    for (const node of ready) if ((at -= weigh(node)) <= 0) return node;
    return ready[ready.length - 1];
  };
  return { born, end, writtenAt, saidAt, rate, pick };
}
