// Which open items a push may have finished, found without a model, and what of the push each one needs to be
// judged by. A model is good at "does this diff do this one item?" and poor at "which of seventy items did this
// push do?", so the pack asks the first, once per item it could be: one a commit names, one a session on the
// branch was working on, or one whose words are in the push.

const STOP = new Set('a an and are as at be by for from has have in into is it its not of on or so that the this to was were with without when what which who will can one two new now all any each only own more less than then there their they them we our you your'.split(' '));

/** The words of a text worth matching on: no short or common ones, and a plural read as its singular. */
export function wordsOf(text) {
  const out = new Set();
  for (const w of String(text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w) || /^\d+$/.test(w)) continue;
    out.add(w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
  }
  return out;
}

/** What a file's patch adds, without the + of each line. */
export const added = (patch) => String(patch ?? '').split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++')).map((l) => l.slice(1)).join('\n');

/**
 * How near an item's title is to the push: each of its words found in a commit message counts twice, in the files'
 * names or added lines once, over twice the words it has.
 */
export function nearness(title, said, changed) {
  const words = wordsOf(title);
  if (!words.size) return 0;
  let score = 0;
  for (const w of words) score += said.has(w) ? 2 : changed.has(w) ? 1 : 0;
  return score / (2 * words.size);
}

/** How near an item has to be to be asked about, and how many are asked about at most. */
export const NEAR = 0.4;
export const MOST = 8;

/**
 * The items to ask about, each with why: the ones commits name, the ones a session on this branch worked on, then
 * the nearest by their words. messages: the commits' messages; files: as GitHub's compare gives them.
 */
export function shortlist(items, { messages, files }, { named = [], worked = [] } = {}) {
  const said = wordsOf(messages.join('\n'));
  const changed = wordsOf(files.map((f) => `${f.filename}\n${added(f.patch)}`).join('\n'));
  const out = [];
  const take = (item, why) => out.length < MOST && !out.some((c) => c.item.id === item.id) && out.push({ item, why });
  for (const item of items) if (named.includes(item.id)) take(item, 'a commit names it');
  for (const item of items) if (worked.includes(item.id)) take(item, 'the session that pushed this branch was working on it');
  const scored = items.map((item) => ({ item, near: nearness(item.title, said, changed) })).filter((s) => s.near >= NEAR);
  for (const s of scored.sort((a, b) => b.near - a.near)) take(s.item, 'its words are in the push');
  return out;
}

/** The files an item needs to be judged by: those whose name or patch has its words, nearest first. */
export function filesFor(item, files) {
  const words = wordsOf(`${item.title} ${item.body ?? ''}`.slice(0, 600));
  const hits = (f) => [...wordsOf(`${f.filename}\n${f.patch ?? ''}`)].filter((w) => words.has(w)).length;
  return files.map((f) => ({ f, n: hits(f) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).map((x) => x.f);
}

const flat = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Whether a line the model quotes is in the push, word for word (spacing and case aside): in a commit's message, or
 * in a line its diff adds. What it says finished an item has to be there to be held for the owner.
 */
export function shows(quote, { messages, files }) {
  const q = flat(quote).replace(/^[+-]\s*/, '');
  if (q.length < 12) return false;
  return [...messages, ...files.map((f) => added(f.patch))].some((text) => flat(text).includes(q));
}
