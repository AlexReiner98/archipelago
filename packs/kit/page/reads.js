// How the page reads the server (task e_bmh2braj: a click sent 15 to 39 requests). Three rules, kept here so no caller
// keeps them itself:
// - The same read is never sent twice at once: a second asker is handed the answer the first is waiting for.
// - Reads asked in the same moment go as one request (`/api/reads`, packs/surface/kernel/reads.ts), each answered as
//   it would be alone; a lone read goes as it always did, under its own name.
// - What moves only with the map (saved views, styles, parts, what is held and shared, the workspace) is kept with
//   where the map stood when it was answered (`at`), and asked again with that (`since`): while the map stands there
//   the server answers `unchanged` without reading it, and the page hands out what it kept (task e_mvuvfba7). A view
//   saved anywhere moves where the map stands, so the next ask has it, with no wait on tail.

/** The reads that may go together: none writes, and the server answers the same list (packs/surface/kernel/reads.ts). */
const TOGETHER = new Set(['get', 'events', 'proposals', 'view', 'search', 'share_list', 'workspace_info', 'published', 'publish_plan', 'picture', 'schema', 'packs']);
/** The reads kept by where the map stands, and the views so: the server's list (packs/surface/kernel/reads.ts, KEEPS). */
const KEEPS = new Set(['proposals', 'workspace_info', 'share_list']);
const KEEPS_VIEWS = new Set(['saved_views', 'style', 'parts', 'shared', 'instructions']);
const keyOf = (tool, input) => `${tool} ${JSON.stringify(input)}`;
const keeps = (tool, input) => KEEPS.has(tool) || (tool === 'view' && KEEPS_VIEWS.has(input?.name));
/** A copy for each asker, so one that changes what it was handed changes nobody else's; a part's code is only read. */
const handed = (tool, input, answer) => (answer === null || typeof answer !== 'object' || (tool === 'view' && input?.name === 'parts') ? answer : structuredClone(answer));

/**
 * The page's `api`: `one(tool, input)` sends one call, `many(calls)` sends reads together (each `{ tool, input }`, with
 * `since` where an answer is held) and answers each as `{ result, at? }`, `{ unchanged: true }` or `{ error }`;
 * `packView(tool)` says whether a pack's tool is one of its views, a read as well; `most` is how many reads one request
 * carries; `holds` how many kept answers it holds at most, the one asked longest ago let go first.
 */
export function reader(one, many, packView = () => false, most = 40, holds = 200) {
  const going = new Map();
  /** Each kept answer by its read, with where the map stood: `{ at, answer }`, the latest asked last. */
  const held = new Map();
  let queue = [];
  const hold = (key, at, answer) => {
    held.delete(key);
    held.set(key, { at, answer });
    if (held.size > holds) held.delete(held.keys().next().value);
  };
  function answered(q, a) {
    if (a?.unchanged === true && q.held) return (hold(q.key, q.held.at, q.held.answer), q.resolve(q.held.answer));
    if (!a || a.error !== undefined || a.unchanged === true) return q.reject(new Error(a?.error ?? 'The server gave no answer to this read.'));
    if (typeof a.at === 'string') hold(q.key, a.at, a.result);
    q.resolve(a.result);
  }
  function flush() {
    // At most as many as the server takes in one request (MOST_TOGETHER, packs/surface/kernel/reads.ts); the rest next.
    const asked = queue.slice(0, most);
    queue = queue.slice(most);
    if (queue.length) setTimeout(flush);
    // A lone read goes under its own name, unless it is kept: only a request of reads carries where the map stood.
    if (asked.length === 1 && !keeps(asked[0].tool, asked[0].input)) return void one(asked[0].tool, asked[0].input).then(asked[0].resolve, asked[0].reject);
    for (const q of asked) q.held = held.get(q.key);
    many(asked.map(({ tool, input, held: h }) => (h ? { tool, input, since: h.at } : { tool, input }))).then(
      (answers) => asked.forEach((q, i) => answered(q, answers?.[i])),
      (err) => asked.forEach((q) => q.reject(err)),
    );
  }
  const together = (tool, input, key) =>
    new Promise((resolve, reject) => {
      if (!queue.length) setTimeout(flush);
      queue.push({ tool, input, key, resolve, reject });
    });
  async function api(tool, input = {}) {
    // Anything else is sent alone: a write, or following the log. What is kept needs no letting go: a write moves where
    // the map stands, and the next ask has the new answer.
    if (!TOGETHER.has(tool) && !packView(tool)) return one(tool, input);
    // No page reads an item's trail, the views it is drawn in or its recent changes (an agent's get has them): its get
    // is bare, which leaves out the reads that cost most (the trail, and every saved view's query run on it).
    if (tool === 'get' && input.bare === undefined) input = { ...input, bare: true };
    const key = keyOf(tool, input);
    let asking = going.get(key);
    if (!asking) {
      asking = together(tool, input, key);
      going.set(key, asking);
      asking.then(
        () => going.delete(key),
        () => going.delete(key),
      );
    }
    return handed(tool, input, await asking);
  }
  return { api };
}
