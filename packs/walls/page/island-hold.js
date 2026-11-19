// An island never drawn bare (lane e_dp3bgymb, screen e_63gcbdke): seconds after a pack changed, a view of islands was
// answered once with its items on no island (the server's registry read islands off while it loaded again, task filed
// on the Archipelago island), and the drawing drew a plain map. Here the picture the host shows is kept instead, the view
// is asked again after the style's island_hold_ms, and the answer then is drawn whatever it holds. Only where the map
// still keeps islands and the answer brings back items the last picture had on islands, each now on none: islands
// turned off, or a query that moved to other items, is drawn at once. No page and no imports: test/island-hold.test.ts.

/** The islands an answer draws: those its items live on and those it names. */
export const islandsIn = (answer) => new Set([...(answer?.items ?? []).map((i) => i.island), ...(answer?.islands ?? []).map((i) => i?.id)].filter((id) => typeof id === 'string'));

/** The items an answer has on an island, by id. */
const placed = (answer) => new Set((answer?.items ?? []).filter((i) => typeof i.island === 'string').map((i) => i.id));

/**
 * Whether to keep the last picture rather than draw `answer`: `last` is the answer it was drawn from, `onIslands`
 * whether the map keeps islands, `held` whether the picture is kept already for an answer like this (then it draws).
 */
export function holdBare(last, answer, onIslands, held = false) {
  if (held || !onIslands || !last) return false;
  const had = islandsIn(last);
  if (!had.size) return false;
  const now = islandsIn(answer);
  if ([...had].some((id) => now.has(id))) return false;
  // The same items, back on no island: a query that moved finds other items, and those it still finds keep theirs.
  const were = placed(last);
  return (answer?.items ?? []).some((i) => were.has(i.id) && typeof i.island !== 'string');
}

/**
 * Hold the picture `host` shows when `answer` would draw its islands bare: answers true, and asks again after `ms`
 * (`again`, by default the view's own refresh, its last answer forgotten so the same one is drawn); the answer it gets
 * then is drawn. A whole answer drawn lets the hold go.
 */
export function heldBare(host, answer, onIslands, ms, again = () => refreshView(host)) {
  if (holdBare(host.drawnAnswer, answer, onIslands, Boolean(host.heldBare))) {
    host.heldBare = setTimeout(() => again(), ms);
    return true;
  }
  clearTimeout(host.heldBare);
  host.heldBare = undefined;
  host.drawnAnswer = answer;
  return false;
}

/** Ask the view a host draws in for its answer again, the one it holds forgotten, so even the same answer is drawn. */
function refreshView(host) {
  const wrap = host.closest?.('.lens-wrap');
  if (!wrap) return;
  wrap.said = undefined;
  wrap.refresh?.();
}
