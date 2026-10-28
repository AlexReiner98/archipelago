// A step's name in at most two lines, so a longer name shows whole: as many words as fit the first line, the rest on
// the second, cut with an ellipsis only where even two lines are too few. Pure: `measure(text)` is how wide a text is.

/** `text` cut to `width`, with an ellipsis where it was cut. */
export function cut(text, width, measure) {
  if (measure(text) <= width) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The lines `text` is drawn in, each at most `width`: one where it fits, else two. */
export function lines(text, width, measure) {
  const said = String(text ?? '').trim();
  if (measure(said) <= width) return [said];
  const words = said.split(/\s+/);
  let first = '';
  let n = 0;
  for (; n < words.length; n++) {
    const next = first ? `${first} ${words[n]}` : words[n];
    if (measure(next) > width) break;
    first = next;
  }
  // A first word wider than a line is cut, on its line, and the rest follows it.
  if (!first) return [cut(words[0], width, measure), ...(words.length > 1 ? [cut(words.slice(1).join(' '), width, measure)] : [])];
  return [first, cut(words.slice(n).join(' '), width, measure)];
}
