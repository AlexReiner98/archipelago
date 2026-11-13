// How long a note is while it is written, counted as the places a post goes count it (an emoji is one character or
// more, never the two halves it is stored as): the sheet page part's, run in its worker. A pack's count piece says which
// section of the note is counted and the limit each value of a field picks; with none, the whole note is counted.
// The host's page/note-count.js is the same counting with its drawing, and goes when this part is drawn in its place.

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const EMOJI = /\p{Extended_Pictographic}/u;
const LINK = /https?:\/\/\S+/g;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/** How much a text weighs against a limit: one a character, or what the limit says an emoji and an address weigh. */
export function weigh(text, limit = {}) {
  let n = 0;
  const rest = limit.link ? text.replace(LINK, () => ((n += limit.link), '')) : text;
  for (const { segment } of graphemes.segment(rest)) n += limit.emoji && EMOJI.test(segment) ? limit.emoji : 1;
  return n;
}

/** The words under a heading of the note, to the next heading as high or higher; null when it has none. */
export function sectionOf(body, title) {
  const lines = body.split('\n');
  const at = lines.findIndex((l) => HEADING.exec(l)?.[2].toLowerCase() === title.toLowerCase());
  if (at < 0) return null;
  const level = HEADING.exec(lines[at])[1].length;
  const end = lines.findIndex((l, i) => i > at && (HEADING.exec(l)?.[1].length ?? 7) <= level);
  return lines.slice(at + 1, end < 0 ? undefined : end).join('\n').trim();
}

/** What a note counts as: n (the longest post, when it splits into posts), how many, and whether it is best, near or over. */
export function counted(body, piece, props = {}) {
  const text = piece?.section ? sectionOf(body, piece.section) : body.trim();
  if (text === null) return null;
  const limit = (piece?.by && piece.limits?.[props[piece.by]]) || null;
  const posts = limit?.split === 'paragraph' ? text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean) : [text];
  const sizes = posts.map((p) => weigh(p, limit ?? {}));
  const n = Math.max(0, ...sizes);
  // Under a limit with no best length, the count stays quiet: only over it, or in or past its best, is it marked.
  const state = !limit ? '' : n > limit.max ? 'over' : limit.high && n > limit.high ? 'near' : limit.low && n >= limit.low ? 'best' : '';
  return { n, posts: posts.length, limit, state };
}
