// The order a part hears the page in (packs/surface/page/part-host.js). What a part is handed is worked out apart each
// time (reads awaited), so two hands begun one after the other may finish the other way round; and a press is made on
// marks the part may already have moved past. Both are put right here, for every part alike.

/**
 * Hands worked out apart, delivered in the order they were begun: one that finishes after a later one was delivered
 * is dropped, so a part is never handed an older page after a newer. `deliver(value, first)` sends it (first: none was
 * delivered yet) and answers false when it could not, which delivers nothing. Answers `hand(work)`, true when delivered.
 */
export function inOrder(deliver) {
  let begun = 0, delivered = 0;
  return async (work) => {
    const n = ++begun;
    const value = await work();
    if (n < delivered || deliver(value, delivered === 0) === false) return false;
    delivered = n;
    return true;
  };
}

/** What a mark names, its key and its looks aside (a tone, a tip): two marks that name the same are the same thing to press. */
const named = (node) => ({ mark: node?.mark, label: node?.at?.label, words: node?.words, item: node?.item, view: node?.view, kids: (node?.kids ?? []).map(named) });
const said = (node) => JSON.stringify(named(node));

/** Every mark in a tree, depth first. */
function* marksOf(node) {
  if (!node || typeof node !== 'object') return;
  yield node;
  for (const kid of node.kids ?? []) yield* marksOf(kid);
}

/**
 * The key a press on `pressed` (the mark the person pressed, as it was drawn) goes to in the part's newer marks
 * (`tree`): its own where the mark under that key still says the same, else the key of the one mark that now says
 * what it said (the part drew it under another key, a row moved), else null: what was pressed is gone, and the press
 * is not taken for another's.
 */
export function pressedIn(tree, pressed) {
  if (pressed?.key === undefined) return null;
  const was = said(pressed);
  let same = null, others = 0;
  for (const m of marksOf(tree)) {
    if (m.key === undefined || said(m) !== was) continue;
    if (m.key === pressed.key) return m.key;
    (same = m.key), others++;
  }
  return others === 1 ? same : null;
}

/** How long, in milliseconds, a press waits for the part to answer the newer page it was handed. */
const pressWaits = 1500;

/**
 * A part's presses, each passed on as on the marks the person pressed. While the part has been handed a page newer than
 * the marks it last answered with (`handed` past `seen`), a press waits for its answer to it, and is then sent to the
 * key that now names what was pressed (`pressedIn`), or not at all where that is gone; after `pressWaits`, as it was.
 * `send(event)` sends an event and answers its number. Answers `handed(n)` (a page sent as message n), `heard(seen,
 * marks?)` (the part's answer: the last message it had heard, and the marks it drew, if any) and `tell(event, mark?)`.
 */
export function pressesHeld(send) {
  let handed = 0, seen = 0, drawn = null;
  const waiting = [];
  // Those the part has caught up with go, in the order pressed.
  const due = () => {
    const now = waiting.filter((w) => seen >= w.at);
    waiting.splice(0, waiting.length, ...waiting.filter((w) => seen < w.at));
    for (const w of now) w.go();
  };
  return {
    handed: (n) => void (handed = Math.max(handed, n)),
    heard(n, marks) {
      if (Number.isFinite(n)) seen = Math.max(seen, n);
      if (marks) drawn = marks;
      due();
    },
    tell(event, mark) {
      if (!mark || seen >= handed) return send(event);
      let gone = false;
      const go = () => {
        if (gone) return;
        gone = true;
        clearTimeout(late);
        const key = drawn ? pressedIn(drawn, mark) : mark.key;
        if (key !== null) send({ ...event, key });
      };
      const late = setTimeout(go, pressWaits);
      waiting.push({ at: handed, go });
      return undefined;
    },
  };
}
