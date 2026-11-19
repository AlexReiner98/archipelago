// Layer: graph. The one seam where the tree's story comes in (the owner, 19 Nov 2026, on task e_yhqubh9k): over a
// window of real days, each miss (a refusal, bump or trap no node covered, where it happened, and the trial node
// written from it if one was), each saying with its verdict (held, failed, quiet; quiet lights as held), and each node's tier (core,
// pack, owner, learned) and standing (trial, current, retired). The reflex_view pack answers it (its view named in
// the view's sends as `story`):
//
//   { from, to, nodes: [{ id, tier, status, for, title? }], misses: [{ at, where, grew? }],
//     said: [{ id, at, verdict }] }
//
// nodes also names each preset said in the window that is no item (core's and the packs'), so the trunk is drawn.
// Until the pack answers it, the story is made from what the map holds (`schematic`): the window is the oldest
// node's making to now; a reflex is learned, one kept with a preset its pack's, any other the owner's; each said
// count (the pack's said_counts, when it came) is spread over the node's days as held; a trial reflex grew from a
// miss at its making. No miss is made up beyond that.

const TIERS = ['core', 'pack', 'owner', 'learned'];
const DAY = 864e5;

const tierOf = (item) => (item?.type === 'reflex' || item?.is?.includes?.('reflex') ? 'learned' : item?.fields?.preset ? 'pack' : 'owner');
const statusOf = (item) => (['trial', 'current', 'retired'].includes(item?.status) ? item.status : item?.open === false ? 'retired' : 'current');

/** The story the pack answered, made whole; or, where it answered none, the schematic one. Times are ms. */
export function storyOf(answer, came, counts, n, now = Date.now(), tiers = new Map()) {
  if (came && Array.isArray(came.nodes)) {
    const nodes = new Map(came.nodes.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, { tier: TIERS.includes(x.tier) ? x.tier : 'owner', status: statusOf(x), for: x.for, title: x.title }]));
    const time = (v) => Date.parse(v);
    return {
      from: time(came.from), to: time(came.to), nodes, schematic: false,
      misses: (came.misses ?? []).map((m) => ({ at: time(m.at), where: m.where, grew: m.grew })).filter((m) => Number.isFinite(m.at)),
      said: (came.said ?? []).map((s) => ({ id: s.id, at: time(s.at), verdict: s.verdict })).filter((s) => Number.isFinite(s.at)),
    };
  }
  const items = (answer.items ?? []).filter((i) => !i.pending && ['instruction', 'reflex'].some((t) => i.type === t || i.is?.includes?.(t)));
  const made = items.map((i) => Date.parse(i.created_at)).filter(Number.isFinite);
  const to = now, from = Math.min(to - n('reflex_window_days') * DAY, ...made);
  const nodes = new Map(items.map((i) => [i.id, { tier: TIERS.includes(tiers.get(i.id)) ? tiers.get(i.id) : tierOf(i), status: statusOf(i), for: i.fields?.for }]));
  const misses = items.filter((i) => tierOf(i) === 'learned' && statusOf(i) === 'trial').map((i) => ({ at: Date.parse(i.created_at), where: [i.fields?.for].flat()[0], grew: i.id }));
  const said = items.flatMap((i) => {
    const c = Math.min(counts?.get(i.id) ?? 0, n('reflex_mock_said_most')), start = Math.max(from, Date.parse(i.created_at) || from);
    return Array.from({ length: c }, (_, k) => ({ id: i.id, at: start + ((to - start) * (k + 0.5)) / c, verdict: 'held' }));
  });
  return { from, to, nodes, misses, said, schematic: true };
}

/** How many misses and held sayings fell in the week to `at`. */
export const weekTo = (story, at) => {
  const since = at - 7 * DAY;
  return { misses: story.misses.filter((m) => m.at > since && m.at <= at).length, held: story.said.filter((s) => s.verdict === 'held' && s.at > since && s.at <= at).length };
};
