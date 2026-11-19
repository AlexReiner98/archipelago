// A drawing's marks read where they stand on the picture: each group moved by `translate(x y)` (an island drawn
// about its own corner, ./layouts/flow/isle-local.js) undone into what it holds, its places, lines and
// moves shifted by it. For tests that read places off the marks: what is on screen, whatever groups hold it.

type Mark = any;

const MOVE = /^translate\(\s*(-?[\d.e+-]+)[\s,]+(-?[\d.e+-]+)\s*\)$/;
const XS = ['x', 'cx', 'x1', 'x2'], YS = ['y', 'cy', 'y1', 'y2'];

/** A path's absolute commands shifted by dx, dy; its relative ones are as they were. */
function shiftPath(d: string, dx: number, dy: number): string {
  return d.replace(/([MLHVCSQTAZ])([^MLHVCSQTAZmlhvcsqtaz]*)/g, (_, cmd: string, args: string) => {
    const nums = (args.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const moved = nums.map((n, k) => {
      if (cmd === 'H') return n + dx;
      if (cmd === 'V') return n + dy;
      if (cmd === 'A') return k % 7 === 5 ? n + dx : k % 7 === 6 ? n + dy : n;
      return k % 2 ? n + dy : n + dx;
    });
    return cmd + moved.join(' ');
  });
}

/** `mark` with every moved group undone into its parent, the places in it shifted to where they are drawn. */
export function unmoved(mark: Mark, dx = 0, dy = 0): Mark {
  if (!Array.isArray(mark) || typeof mark[0] !== 'string') return mark;
  const [tag, attrs = {}, ...kids] = mark;
  const move = tag === 'g' && MOVE.exec(String(attrs.transform ?? ''));
  if (move) {
    const { transform: _t, ...rest } = attrs;
    // A group moved and keyed (an island's) keeps its key, unmoved: what holds its marks is still found by it.
    return [tag, rest, ...kids.map((k: Mark) => unmoved(k, dx + Number(move[1]), dy + Number(move[2])))];
  }
  if (!dx && !dy) return [tag, attrs, ...kids.map((k: Mark) => unmoved(k))];
  const out: Record<string, unknown> = { ...attrs };
  for (const k of XS) if (out[k] !== undefined && out[k] !== '') out[k] = String(Number(out[k]) + dx);
  for (const k of YS) if (out[k] !== undefined && out[k] !== '') out[k] = String(Number(out[k]) + dy);
  if (typeof out.d === 'string') out.d = shiftPath(out.d, dx, dy);
  const own = MOVE.exec(String(out.transform ?? ''));
  if (own) out.transform = `translate(${Number(own[1]) + dx} ${Number(own[2]) + dy})`;
  // What is in it is shifted too, unless it moved its own units already.
  const inner = own ? [0, 0] : [dx, dy];
  return [tag, out, ...kids.map((k: Mark) => unmoved(k, inner[0], inner[1]))];
}
