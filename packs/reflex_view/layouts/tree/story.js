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
// rules, from the pack's view rules (sent as `rules`): [{ id, title, pack, effect, where, fired: [at] }], each a node
// under the place it guards ("tool:change:task:status"), each firing an event: the harness acting with no model.
// Until the pack answers it, the story is made from what the map holds (`schematic`): the window is the oldest
// node's making to now; a reflex is learned, one kept with a preset its pack's, any other the owner's; each said
// count (the pack's said_counts, when it came) is spread over the node's days as held; a trial reflex grew from a
// miss at its making. No miss is made up beyond that.

const TIERS = ['core', 'pack', 'owner', 'learned'];
const DAY = 864e5;

const tierOf = (item) => (item?.type === 'reflex' || item?.is?.includes?.('reflex') ? 'learned' : item?.fields?.preset ? 'pack' : 'owner');
const statusOf = (item) => (['trial', 'current', 'retired'].includes(item?.status) ? item.status : item?.open === false ? 'retired' : 'current');

/** A rule's name: its title, unless that is a message with blanks in it ("{title}"), then its own name, pack.rule. */
const nameOfRule = (r) => (typeof r.title === 'string' && r.title && !/[{}]/.test(r.title) ? r.title : String(r.id).split('.').slice(1).join('.').replaceAll('_', ' ') || r.id);

/** The rules the pack answered, each with its firings as times. */
export const rulesOf = (rules) =>
  (Array.isArray(rules) ? rules : []).filter((r) => r && typeof r.id === 'string' && typeof r.where === 'string').map((r) => ({ id: r.id, title: nameOfRule(r), pack: r.pack ?? 'core', effect: r.effect, where: r.where, fired: (r.fired ?? []).map((at) => Date.parse(at)).filter(Number.isFinite) }));

/** The story the pack answered, made whole; or, where it answered none, the schematic one. Times are ms. */
export function storyOf(answer, came, counts, n, now = Date.now(), tiers = new Map()) {
  if (came && Array.isArray(came.nodes)) {
    const nodes = new Map(came.nodes.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, { tier: TIERS.includes(x.tier) ? x.tier : 'owner', status: statusOf(x), for: x.for, title: x.title, ...(typeof x.pack === 'string' && { pack: x.pack }) }]));
    const time = (v) => Date.parse(v);
    return {
      from: time(came.from), to: time(came.to), nodes, schematic: false, rules: rulesOf(came.rules),
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
  return { from, to, nodes, misses, said, schematic: true, rules: [] };
}

/** How many misses and held sayings fell in the week to `at`. */
export const weekTo = (story, at) => {
  const since = at - 7 * DAY;
  return { misses: story.misses.filter((m) => m.at > since && m.at <= at).length, held: story.said.filter((s) => s.verdict !== 'failed' && s.verdict !== 'came_back' && s.at > since && s.at <= at).length };
};

/**
 * The story from the reflex_view pack's two reads, as the seam takes it: its said_counts (each node's tier, status,
 * for, and per_run sayings with their verdicts) and its misses ({ at, where, covered_by }, newest first). A miss no
 * node covers is a gap; one covered by a node still on trial is that trial's making; one a standing node covers was
 * no miss of the tree's. A quiet saying (its miss never showed) lights as held.
 */
export function toldFrom(records, misses, now, days, rules = []) {
  const trial = new Set(records.filter((r) => r.status === 'trial').map((r) => r.id));
  return {
    from: new Date(now - days * DAY).toISOString(), to: new Date(now).toISOString(),
    nodes: records.map((r) => ({ id: r.id, tier: r.tier, status: r.status, for: r.for, pack: r.pack })),
    rules,
    misses: misses.flatMap((m) => {
      const covered = Array.isArray(m.covered_by) ? m.covered_by : [];
      if (!covered.length) return [{ at: m.at, where: m.where }];
      const grew = covered.find((id) => trial.has(id));
      return grew ? [{ at: m.at, where: m.where, grew }] : [];
    }),
    said: records.flatMap((r) => (Array.isArray(r.per_run) ? r.per_run : []).map((p) => ({ id: r.id, at: p.said_at, verdict: p.verdict === 'quiet' ? 'held' : p.verdict }))),
  };
}

/** The pack a node came from: a rule's own, else what the story says, else its tier (core, owner, learned); none for a bough. */
export const packOf = (node, story) => {
  if (!node.item && !node.preset) return null;
  const rule = (story.rules ?? []).find((r) => r.id === node.id);
  if (rule) return rule.pack;
  const x = story.nodes.get(node.id);
  return x?.pack ?? x?.tier ?? 'owner';
};
/** The class a pack's hue is drawn by. */
export const packClass = (pack) => `rt-p-${String(pack).toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;

/**
 * The schema the pack answered (its view schema, sent as `schema`): every type and the checks it implies, each
 * { id, kind (type or check), pack, tier (schema), for, title, words, guards, fired (a check's refusals, as times) }.
 */
export const schemaOf = (nodes) =>
  (Array.isArray(nodes) ? nodes : [])
    .filter((x) => x && typeof x.id === 'string' && (x.kind === 'type' || x.kind === 'check'))
    .map((x) => ({ id: x.id, kind: x.kind, pack: x.pack ?? 'core', title: x.title ?? x.id, for: Array.isArray(x.for) ? x.for : [x.for].filter(Boolean), guards: x.guards, words: x.words, fired: (x.fired ?? []).map((at) => Date.parse(at)).filter(Number.isFinite) }));
