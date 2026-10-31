// Small things every layer of a wired drawing says of links and lines. Pure.

/** The one name of a link between two items, whichever way it is read. */
export const pair = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** A line with repeated points and points along a straight run taken out, as a line of its own. */
export function tidy(points) {
  const out = [];
  for (const p of points) {
    if (out.length && out.at(-1)[0] === p[0] && out.at(-1)[1] === p[1]) continue;
    if (out.length > 1) {
      const [a, b] = [out.at(-2), out.at(-1)];
      if ((a[0] === b[0] && b[0] === p[0]) || (a[1] === b[1] && b[1] === p[1])) out.pop();
    }
    out.push([...p]);
  }
  return out;
}
