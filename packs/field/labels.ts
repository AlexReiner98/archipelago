/**
 * Where titles go on the canvas. Pure: it works in screen pixels on what
 * it is given, and draws nothing.
 *
 * - Titles are placed in order of what matters: the particle pointed at,
 *   its neighbours, what the find line finds, the hubs (the most linked, a
 *   set that holds still: `hubSet`), what was named last frame (so names
 *   hold still while the map settles), then the largest on screen. A title
 *   tries the spot it had last frame first.
 * - A particle wide enough on screen holds its title inside itself (the
 *   caller cuts the title to fit, and says so with `inside`).
 *   Otherwise a title tries eight spots round its particle (right, left,
 *   above, below, and the four corners) and takes the first that stays
 *   inside the view, overlaps no title already placed and nothing the view
 *   keeps clear (the legend), and covers no other particle. One that fits
 *   nowhere is not named.
 * - At most one title per `room` square pixels of the view, and never more
 *   than `most`, so a small canvas is not buried in words.
 */
export interface Want {
  /** The particle's index. */
  i: number;
  /** Its centre and radius on screen. */
  x: number;
  y: number;
  r: number;
  /** The title's width and height on screen. */
  w: number;
  h: number;
  /** Placed even over particles (the particle pointed at, its neighbours). */
  must?: boolean;
  /** Written inside its own particle, if that spot is free. */
  inside?: boolean;
  /** The spot it took last frame (index into the eight), tried first so a title does not hop round its particle. */
  spot?: number;
}
export interface Placed {
  i: number;
  /** The title's box: left, top, right, bottom. */
  box: [number, number, number, number];
}
export interface Room {
  width: number;
  height: number;
  /** Square pixels of view per title. */
  room: number;
  most: number;
  /** Space between a particle and its title, in px. */
  gap: number;
  /** Whether a box covers a particle other than i (screen px). */
  covers(box: [number, number, number, number], i: number): boolean;
  /** Boxes no title may overlap (the legend). */
  clear?: [number, number, number, number][];
}
export interface PlacedIn extends Placed {
  /** Written inside its own particle. */
  within?: boolean;
  /** Which of the eight spots it took (-1: inside). */
  spot: number;
}

/**
 * The hubs to name at any zoom: the `most` most linked with at least `least`
 * links, ranked by links (ties by id, so a rebuilt graph ranks alike). One
 * named before (`had`) stays while it ranks within `most + keep`: the set
 * holds still while links come and go, and never changes frame to frame.
 */
export function hubSet(ids: readonly string[], links: ArrayLike<number>, had: ReadonlySet<string>, most: number, least: number, keep: number): Set<string> {
  const order = ids.map((_, i) => i).filter((i) => links[i]! >= Math.max(1, least));
  order.sort((p, q) => links[q]! - links[p]! || (ids[p]! < ids[q]! ? -1 : ids[p]! > ids[q]! ? 1 : 0));
  const out = new Set<string>();
  order.forEach((i, rank) => {
    if (rank < most || (had.has(ids[i]!) && rank < most + keep)) out.add(ids[i]!);
  });
  return out;
}

type Box = [number, number, number, number];

export function place(wants: Want[], at: Room): PlacedIn[] {
  const budget = Math.min(at.most, Math.max(1, Math.floor((at.width * at.height) / Math.max(1, at.room))));
  const out: PlacedIn[] = [];
  // Placed boxes in a grid of cells, so each test looks at its neighbourhood only.
  const cell = 64, cells = new Map<number, Box[]>();
  const key = (cx: number, cy: number) => cx * 100003 + cy;
  const each = (b: Box, fn: (list: Box[], k: number) => void) => {
    for (let cx = Math.floor(b[0] / cell); cx <= Math.floor(b[2] / cell); cx++)
      for (let cy = Math.floor(b[1] / cell); cy <= Math.floor(b[3] / cell); cy++) {
        const k = key(cx, cy);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        fn(list, k);
      }
  };
  const free = (b: Box) => {
    let ok = true;
    each(b, (list) => {
      if (ok) for (const t of list) if (b[0] < t[2] && b[2] > t[0] && b[1] < t[3] && b[3] > t[1]) return void (ok = false);
    });
    return ok;
  };
  const inView = (b: Box) => b[0] >= 2 && b[1] >= 2 && b[2] <= at.width - 2 && b[3] <= at.height - 2;
  for (const b of at.clear ?? []) each(b, (list) => list.push(b));
  for (const t of wants) {
    if (out.length >= budget && !t.must) break;
    const g = t.r + at.gap, hw = t.w / 2, hh = t.h / 2;
    // Wide enough: the title inside its own particle, which covers nothing else.
    if (t.inside) {
      const b: Box = [t.x - hw, t.y - hh, t.x + hw, t.y + hh];
      if (inView(b) && free(b)) {
        each(b, (list) => list.push(b));
        out.push({ i: t.i, box: b, within: true, spot: -1 });
        continue;
      }
    }
    // Right, left, above, below, then the corners: [left, top] of the box.
    const spots: [number, number][] = [
      [t.x + g, t.y - hh],
      [t.x - g - t.w, t.y - hh],
      [t.x - hw, t.y - g - t.h],
      [t.x - hw, t.y + g],
      [t.x + g * 0.7, t.y - g * 0.7 - t.h],
      [t.x - g * 0.7 - t.w, t.y - g * 0.7 - t.h],
      [t.x + g * 0.7, t.y + g * 0.7],
      [t.x - g * 0.7 - t.w, t.y + g * 0.7],
    ];
    // Last frame's spot first, so a title keeps its side while the map moves under it.
    const tries = spots.map((_, k) => k);
    if (t.spot !== undefined && t.spot >= 0 && t.spot < spots.length) tries.splice(t.spot, 1), tries.unshift(t.spot);
    for (const k of tries) {
      const [lx, ty] = spots[k]!;
      const b: Box = [lx, ty, lx + t.w, ty + t.h];
      if (!inView(b) || !free(b) || (!t.must && at.covers(b, t.i))) continue;
      each(b, (list) => list.push(b));
      out.push({ i: t.i, box: b, spot: k });
      break;
    }
  }
  return out;
}
