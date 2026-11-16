// How the page reads the server (task e_bmh2braj: a click sent 15 to 39 requests). Three rules, kept here so no caller
// keeps them itself:
// - The same read is never sent twice at once: a second asker is handed the answer the first is waiting for.
// - Reads asked in the same moment go as one request (`/api/reads`, packs/surface/kernel/reads.ts), each answered as
//   it would be alone; a lone read goes as it always did, under its own name.
// - What does not change between clicks (the parts, what is shared, the workspace) is kept
//   until the map moves: tail says so (`forgetReads`, packs/surface/page/live.js), and so does anything the page sends
//   that is not a read, as it may have changed the map itself.

/** The reads that may go together: none writes, and the server answers the same list (packs/surface/kernel/reads.ts). */
const TOGETHER = new Set(['get', 'events', 'proposals', 'view', 'search', 'share_list', 'workspace_info', 'published', 'publish_plan', 'picture', 'schema', 'packs']);
/**
 * The views kept until the map moves, and the other reads kept so. Not the saved views: anyone saving one changes
 * them, and a canvas opened before tail says so would be named as new, not saved (test/saved-canvases-switch.test.ts).
 */
const KEPT_VIEWS = new Set(['parts', 'shared']);
const KEPT = new Set(['workspace_info']);
/** What the page sends that is neither a read nor a change: following the log changes nothing. */
const FOLLOWS = new Set(['tail']);

const keyOf = (tool, input) => `${tool} ${JSON.stringify(input)}`;
const keeps = (tool, input) => KEPT.has(tool) || (tool === 'view' && KEPT_VIEWS.has(input?.name));
/** A copy for each asker, so one that changes what it was handed changes nobody else's; a part's code is only read. */
const handed = (tool, input, answer) => (answer === null || typeof answer !== 'object' || (tool === 'view' && input?.name === 'parts') ? answer : structuredClone(answer));

/**
 * The page's `api`: `one(tool, input)` sends one call, `many(calls)` sends reads together and answers each as
 * `{ result }` or `{ error }`; `packView(tool)` says whether a pack's tool is one of its views, a read as well; `most`
 * is how many reads one request carries.
 * Answers the call, and `forget`, which lets go of what is kept.
 */
export function reader(one, many, packView = () => false, most = 40) {
  const going = new Map();
  const kept = new Map();
  let queue = [];
  const forget = () => kept.clear();
  function flush() {
    // At most as many as the server takes in one request (MOST_TOGETHER, packs/surface/kernel/reads.ts); the rest next.
    const asked = queue.slice(0, most);
    queue = queue.slice(most);
    if (queue.length) setTimeout(flush);
    if (asked.length === 1) return void one(asked[0].tool, asked[0].input).then(asked[0].resolve, asked[0].reject);
    many(asked.map(({ tool, input }) => ({ tool, input }))).then(
      (answers) => asked.forEach((q, i) => (answers?.[i] && answers[i].error === undefined ? q.resolve(answers[i].result) : q.reject(new Error(answers?.[i]?.error ?? 'The server gave no answer to this read.')))),
      (err) => asked.forEach((q) => q.reject(err)),
    );
  }
  const together = (tool, input) =>
    new Promise((resolve, reject) => {
      if (!queue.length) setTimeout(flush);
      queue.push({ tool, input, resolve, reject });
    });
  async function api(tool, input = {}) {
    if (!TOGETHER.has(tool) && !packView(tool)) {
      if (FOLLOWS.has(tool)) return one(tool, input);
      // Anything else may change the map: what was kept is let go once it has answered, as tail would say anyway.
      forget();
      try {
        return await one(tool, input);
      } finally {
        forget();
      }
    }
    // No page reads an item's trail, the views it is drawn in or its recent changes (an agent's get has them): its get
    // is bare, which leaves out the reads that cost most (the trail, and every saved view's query run on it).
    if (tool === 'get' && input.bare === undefined) input = { ...input, bare: true };
    const key = keyOf(tool, input);
    let asking = kept.get(key) ?? going.get(key);
    if (!asking) {
      asking = together(tool, input);
      going.set(key, asking);
      if (keeps(tool, input)) kept.set(key, asking);
      asking.then(
        () => going.delete(key),
        () => (going.delete(key), kept.get(key) === asking && kept.delete(key)),
      );
    }
    return handed(tool, input, await asking);
  }
  return { api, forget };
}
