// How much work a picture may spend on looking better than it must (flow_picture_work), so a view of any size draws: the
// search's trials, a second drawing of each level, the wires' shaping and a bundle's splits all spend from one budget, and
// once it is spent each takes its plain way. Work is counted, never timed, so a picture is the same each time it is asked
// and on every machine. Layer: graph. Pure: numbers in, numbers out.

/** A picture's budget: `left` to spend, and `cuts`, how many times something was left undone for want of it. */
export const effortOf = (work) => ({ left: typeof work === 'number' ? work : Infinity, cuts: 0 });

/** Spends `cost`, if there is that much left: whether it was. What is not spent is counted as a cut. */
export function spend(effort, cost) {
  if (!effort) return true;
  if (effort.left < cost) {
    effort.cuts++;
    return false;
  }
  effort.left -= cost;
  return true;
}

/** Spends `cost` whether or not there is that much left: what a picture cannot go without. */
export function charge(effort, cost) {
  if (effort) effort.left -= cost;
}

/** What `f` spent of `effort`, and how many cuts it made, alongside what it answers. */
export function measured(effort, f) {
  const [left, cuts] = [effort?.left ?? Infinity, effort?.cuts ?? 0], out = f();
  return { out, cost: effort ? left - effort.left : 0, cuts: effort ? effort.cuts - cuts : 0, leftAt: left };
}

/**
 * Whether a piece worked out before (`cost` spent from `leftAt`, `cuts` made) would come out the same now that `effort`
 * has what it has left: one that cut nothing does all it did with more than its cost left, as every check it passed
 * asked for no more than what it went on to spend; one that cut needs just what it had.
 */
export const stillHolds = (piece, effort) => {
  const left = effort?.left ?? Infinity;
  return piece.cuts ? left === piece.leftAt : left > piece.cost || left === piece.leftAt;
};

/** Takes what a piece worked out before spent from `effort` again, as if it had been worked out now. */
export function spendAgain(effort, piece) {
  if (!effort) return;
  effort.left -= piece.cost;
  effort.cuts += piece.cuts;
}
