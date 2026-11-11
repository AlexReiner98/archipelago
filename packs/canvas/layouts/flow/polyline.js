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

/** Whether the stretch of `line` through `at` runs up or down the picture. */
export const upright = (line, [x, y]) => line.some((p, i) => i && p[0] === x && line[i - 1][0] === x && Math.min(p[1], line[i - 1][1]) <= y && Math.max(p[1], line[i - 1][1]) >= y);

/** A line as an SVG path, broken `half` either side of each of `gaps`, where it passes under another. */
export function drawn(line, gaps = [], half = 0) {
  let d = `M${line[0].join(' ')}`;
  line.slice(1).forEach(([x, y], i) => {
    const [px, py] = line[i], long = Math.abs(x - px) + Math.abs(y - py), [ux, uy] = [Math.sign(x - px), Math.sign(y - py)];
    const on = gaps.map(([gx, gy]) => (gx - px) * ux + (gy - py) * uy).filter((t, k) => t > half && t < long - half && gaps[k][0] === px + t * ux && gaps[k][1] === py + t * uy).sort((p, q) => p - q);
    for (const t of on) d += `L${px + (t - half) * ux} ${py + (t - half) * uy}M${px + (t + half) * ux} ${py + (t + half) * uy}`;
    d += `L${x} ${y}`;
  });
  return d;
}
