// A slide written as one SVG: a few of its steps, whole, as ridges() drew them, each fading in over the last, so it
// stays sharp at any width and holds nothing but drawing. Shapes in, an SVG out; no page.

/** The points of a line that stand more than tol off the straight line between those kept. */
function fewer(p, tol) {
  if (p.length < 3) return p;
  const keep = [p[0]];
  const walk = (a, b) => {
    const [x1, y1] = p[a], [x2, y2] = p[b], dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    let far = -1, at = 0;
    for (let i = a + 1; i < b; i++) {
      const off = len ? Math.abs(dy * p[i][0] - dx * p[i][1] + x2 * y1 - y2 * x1) / len : Math.hypot(p[i][0] - x1, p[i][1] - y1);
      if (off > far) (far = off), (at = i);
    }
    if (far > tol) walk(a, at), keep.push(p[at]), walk(at, b);
  };
  walk(0, p.length - 1);
  keep.push(p.at(-1));
  return keep;
}

/** A shape's outline as a path's numbers, whole units apart and relative, so it packs small. */
export function written(points, units, tol, closed) {
  let d = '', px = 0, py = 0;
  fewer(points, tol).forEach(([x, y], i) => {
    const X = Math.round(x * units), Y = Math.round(y * units);
    d += i ? `${i > 1 ? ' ' : ''}${X - px}${Y - py < 0 ? '' : ' '}${Y - py}` : `M${X} ${Y}l`;
    (px = X), (py = Y);
  });
  return d + (closed ? 'z' : '');
}

const channels = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
/** A colour part way to another, written short. */
export function mixed(a, b, t) {
  const [p, q] = [channels(a), channels(b)];
  return `#${p.map((c, k) => Math.round(c + (q[k] - c) * t).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * keys: [{ pic, fill(shape) }] in order. Each after the first is a group that fades in over what is under it, and what
 * it has covered leaves the drawing, as a hidden group is still painted: only two are ever drawn at once, and playing
 * holds its frame rate however many keys there are. `tol` is how far an outline may stray, in page units.
 */
export function svgOf({ keys, ink, swell, background, cloudOpacity, seconds, hold, units = 2, tol = 0.5 }) {
  const { width: W, height: H, line } = keys[0].pic;
  const each = seconds / Math.max(1, keys.length - 1);
  const shapeOf = (s, fill) => {
    if (s.line) return `<path fill="none" stroke="${swell}" stroke-width="${(Math.max(0.6, line * 0.8) * units).toFixed(2)}" d="${written(s.points, units, 0, false)}"/>`;
    if (s.shadow) return `<path fill="#000" fill-opacity="${(0.35 * s.shadow).toFixed(3)}" stroke="none" d="${written(s.points, units, tol, true)}"/>`;
    const thin = 'sea' in s ? 0.5 : s.cloud ? 0.6 : 0;
    return `<path fill="${fill(s)}"${s.cloud ? ` fill-opacity="${cloudOpacity}"` : ''}${thin ? ` stroke-width="${(thin * line * units).toFixed(2)}"` : ''} d="${written(s.points, units, tol, true)}"/>`;
  };
  const layers = keys.map(({ pic, fill }, k) => {
    const show = (at, value) => `<animate attributeName="display" begin="${at.toFixed(2)}s" dur="0.01s" fill="freeze" calcMode="discrete" values="${value};${value}"/>`;
    const comes = k ? `<animate attributeName="opacity" begin="${(hold + (k - 1) * each).toFixed(2)}s" dur="${each.toFixed(2)}s" fill="freeze" values="0;1"/>${show(hold + (k - 1) * each, 'inline')}` : '';
    const goes = k < keys.length - 1 ? show(hold + (k + 1) * each, 'none') : '';
    return `<g${k ? ' opacity="0" display="none"' : ''}>${comes}${goes}${pic.shapes.map((s) => shapeOf(s, fill)).join('')}</g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W * units} ${H * units}"><rect width="${W * units}" height="${H * units}" fill="${background}"/><g stroke="${ink}" stroke-width="${(line * units).toFixed(2)}" stroke-linejoin="round" stroke-linecap="round">${layers.join('')}</g></svg>`;
}
