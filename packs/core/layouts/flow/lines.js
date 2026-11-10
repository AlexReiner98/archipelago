// A step's name in at most two lines, so a longer name shows whole: as many words as fit the first line, the rest on
// the second, cut with an ellipsis only where even two lines are too few. Pure: `measure(text)` is how wide a text is.

/**
 * The longest start of `text`, one character at the least, that `fits` with an ellipsis after it. Found by halving, so a
 * long name cut to a short width is measured some ten times, not once for every character it loses: the first picture
 * in a worker measures each anew, and a view of a few hundred findings made 15,000 such measures (e_e2qv3dsh). The same
 * start a cut from the end would find, as a text grows no narrower as it grows longer.
 */
export function longest(text, fits) {
  return text.slice(0, most(1, text.length, (n) => fits(`${text.slice(0, n)}…`)));
}

/** The most of lo..hi that `fits`, halving; lo where none above it does. */
function most(lo, hi, fits) {
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (fits(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** `text` cut to `width`, with an ellipsis where it was cut. */
export function cut(text, width, measure) {
  if (measure(text) <= width) return text;
  return `${longest(text, (t) => measure(t) <= width).trimEnd()}…`;
}

/** The lines `text` is drawn in, each at most `width`: one where it fits, else two. */
export function lines(text, width, measure) {
  const said = String(text ?? '').trim();
  if (measure(said) <= width) return [said];
  const words = said.split(/\s+/);
  // As many words as fit the first line, found by halving as a cut is.
  const n = most(0, words.length, (k) => measure(words.slice(0, k).join(' ')) <= width);
  const first = words.slice(0, n).join(' ');
  // A first word wider than a line is cut, on its line, and the rest follows it.
  if (!first) return [cut(words[0], width, measure), ...(words.length > 1 ? [cut(words.slice(1).join(' '), width, measure)] : [])];
  return [first, cut(words.slice(n).join(' '), width, measure)];
}
