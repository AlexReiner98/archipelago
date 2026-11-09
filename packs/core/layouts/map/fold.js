// An island seen far off folded to one shape (task e_yn9f9zpn, bug e_a9w5jeme; decision e_3uhaevp6's second answer):
// when a picture holds more than its style lets it read whole, each company island past what it keeps is drawn as one
// step, its name and how many of its items the answer holds, and every link to its items ends on that step. The island
// the view is about stays whole: the lens's `from` (or the island it lives on), else the one most of the answer's seeds
// live on. When to fold is counted from the answer alone (the style's flow_fold_most items, flow_fold_whole islands
// beside the home one), never timed, so the picture is the same each time. Islands are kept whole smallest first.
// Layer: metrics. Pure: an answer and the style's sizes in, the answer to draw out.

/** The island the view is about: its `from`'s, or the one most of its seeds (what its find found) live on. */
export function homeOf(answer) {
  const items = answer.items ?? [], from = answer.lens?.from;
  if (from) {
    if ((answer.islands ?? []).some((i) => i.id === from)) return from;
    const at = items.find((i) => i.id === from)?.island;
    if (at) return at;
  }
  const count = new Map();
  for (const i of items) if (i.island && i.found?.length) count.set(i.island, (count.get(i.island) ?? 0) + 1);
  if (!count.size) for (const i of items) if (i.island) count.set(i.island, (count.get(i.island) ?? 0) + 1);
  let best = null;
  for (const [id, n] of count) if (best === null || n > count.get(best)) best = id;
  return best;
}

/** Which islands fold: past the whole the style keeps (`whole` beside home), or while the picture would hold more than `most`. */
export function foldsOf(items, home, { most, whole }) {
  const sizes = new Map();
  for (const i of items) if (i.island && i.island !== home) sizes.set(i.island, (sizes.get(i.island) ?? 0) + 1);
  // Smallest first, then as they come: a small island costs least to keep whole.
  const order = [...sizes.keys()].sort((a, b) => sizes.get(a) - sizes.get(b));
  let shown = items.length - [...sizes.values()].reduce((s, n) => s + n, 0) + sizes.size, kept = 0;
  const folds = new Set();
  for (const id of order) {
    const after = shown + sizes.get(id) - 1;
    if (kept < whole && after <= most) (kept += 1), (shown = after);
    else folds.add(id);
  }
  return { folds, sizes };
}

/**
 * The answer as drawn: each folded island holds one step, how many of its items the answer holds, that opens the
 * island's page (`opens`); its items gone, the links to and from them on it, one per type and way, those within it gone.
 */
export function folded(answer, sizes) {
  const most = sizes.flow_fold_most, whole = sizes.flow_fold_whole;
  if (typeof most !== 'number' || typeof whole !== 'number') throw new Error('The style names no size "flow_fold_most" or "flow_fold_whole": the house style (packs/core/pack.json) names every one a drawing uses');
  const items = answer.items ?? [];
  const home = homeOf(answer), { folds, sizes: counts } = foldsOf(items, home, { most, whole });
  if (!folds.size) return answer;
  const named = new Map((answer.islands ?? []).map((i) => [i.id, i.title]));
  const onto = new Map(items.filter((i) => folds.has(i.island)).map((i) => [i.id, `fold:${i.island}`]));
  const shapes = [...folds].map((id) => {
    const n = counts.get(id), title = named.get(id) ?? id;
    return { id: `fold:${id}`, type: 'island', title: `${n} item${n === 1 ? '' : 's'}`, said: `${title}: ${n} of its item${n === 1 ? '' : 's'} here, folded`, open: true, status: 'current', phase: 'standing', island: id, folded: n, opens: id };
  });
  const seen = new Set(), links = [];
  for (const l of answer.links ?? []) {
    const from = onto.get(l.from) ?? l.from, to = onto.get(l.to) ?? l.to, type = l.type ?? l.kind;
    if (from === to && onto.has(l.from)) continue;
    const key = `${type} ${from} ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(from === l.from && to === l.to ? l : { ...l, id: `fold:${key}`, from, to });
  }
  // The island's own item, where the answer holds it, is the folded shape.
  const kept = items.filter((i) => !onto.has(i.id) && !folds.has(i.id));
  return { ...answer, items: [...kept, ...shapes], links, folds: [...folds] };
}
