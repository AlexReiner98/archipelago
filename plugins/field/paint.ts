/**
 * Painting the field on a 2D canvas: links as faint lines, one path per
 * kind; particles in their type's colour, each filled on its own (one
 * path of many circles fills far slower on a GPU canvas); the lit particle
 * and its links over the faded rest; then titles in screen space, each with a halo of the sea round its letters.
 */
import { HUES, read } from "../../spec/style.ts";
import type { G, Grid, Settings } from "./graph.ts";
import { place, type Want } from "./labels.ts";
import { FAINT, FOUND } from "./filter.ts";
import { CIRCLE, edge, outline } from "./shapes.ts";
import { arrow, placeWires, wireName, wireSize, type WireWant } from "./wires.ts";
import { comeFade } from "./gone.ts";
import type { Light } from "./light.ts";
import { clip, particle, wrap } from "./particle.ts";

export interface Ink {
  sea: string;
  text: string;
  muted: string;
  line: string;
  accent: string;
  /** A tree's branches: the context view's own ink for them. */
  branch: string;
}
/** The page's colours, from the style tokens (their plain values when no style is loaded). */
export function ink(el: Element): Ink {
  return { sea: read("bg", el), text: read("fg", el), muted: read("dim", el), line: read("dim", el), accent: read("pick", el), branch: read("say", el) };
}

/**
 * The titles that took another spot than last frame's while their particle held still (within `still` px on
 * screen since then): one newly named, kept where it was, or carried by a moving particle has not moved.
 */
export function movedTitles(was: ReadonlyMap<string, number>, now: [string, number | undefined][], wasAt?: ReadonlyMap<string, [number, number]>, at?: ReadonlyMap<string, [number, number]>, still = 2): string[] {
  return now
    .filter(([id, spot]) => {
      if (!was.has(id) || was.get(id) === spot) return false;
      const a = wasAt?.get(id), b = at?.get(id);
      return !a || !b || Math.hypot(a[0] - b[0], a[1] - b[1]) <= still;
    })
    .map(([id]) => id);
}

/** The style's hues, for types in order; a type past the sixth gets its own (graph.ts hue). */
export function palette(el?: Element): string[] {
  return HUES.map((h) => read(h, el));
}

export interface Cam {
  k: number;
  tx: number;
  ty: number;
}

/**
 * `match`: how each particle is drawn while the find line has words (filter.ts
 * FOUND, NEAR, FAINT), or null when it has none; FAINT is drawn at `query_fade`,
 * and only FOUND is always named.
 */
export function paint(c: CanvasRenderingContext2D, g: G, cam: Cam, S: Settings, light: Light, ink: Ink, grid: Grid, size: { width: number; height: number; dpr: number }, match: Uint8Array | null = null, clear: [number, number, number, number][] = [], quiet: ReadonlySet<number> | null = null): void {
  const { width, height, dpr } = size;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.globalAlpha = 1;
  c.fillStyle = ink.sea;
  c.fillRect(0, 0, width, height);
  if (!g.n) return;
  const vx0 = -cam.tx / cam.k, vy0 = -cam.ty / cam.k, vx1 = (width - cam.tx) / cam.k, vy1 = (height - cam.ty) / cam.k;
  const inView = (i: number, pad: number) => g.x[i]! > vx0 - pad && g.x[i]! < vx1 + pad && g.y[i]! > vy0 - pad && g.y[i]! < vy1 + pad;
  const faint = 1 - light.dim * (1 - S.hover_dim!);
  const { shine, shining, focus } = light;

  c.setTransform(dpr * cam.k, 0, 0, dpr * cam.k, dpr * cam.tx, dpr * cam.ty);
  // Links, faint, one path per kind (and per found or not); part_of in the muted ink.
  c.lineWidth = S.link_width! / cam.k;
  const partOf = g.linkKinds.indexOf("part_of");
  const at = performance.now();
  // A particle new to the map fades in (gone.ts); one already there is whole.
  const come = (i: number) => (g.born && S.come_ms ? comeFade(at - g.born[i]!, S.come_ms) : 1);
  const fade = (i: number) => (match && match[i] === FAINT ? S.query_fade! : 1) * come(i);
  const full = (i: number) => (match ? (match[i] !== FAINT ? 1 : 0) : 1);
  // Lit particles grow, only into the room round them (drawn after the links); the one pointed at also has a
  // ring. Their drawn edge is known first, so an arrowhead at one ends there rather than under it.
  let rmax = 0;
  for (let i = 0; i < g.n; i++) rmax = Math.max(rmax, g.r[i]!);
  const gap = S.collide_gap ?? 1;
  const grown = new Map<number, number>();
  for (const i of shining) {
    const want = g.r[i]! * (1 + shine[i]! * (i === focus ? S.hover_grow! : S.hover_grow! / 3));
    let room = want;
    const reach = want + rmax + gap;
    grid.each(g.x[i]! - reach, g.y[i]! - reach, g.x[i]! + reach, g.y[i]! + reach, (j) => {
      if (j === i) return;
      const d = Math.hypot(g.x[j]! - g.x[i]!, g.y[j]! - g.y[i]!), free = d - g.r[i]! - g.r[j]! - gap / 2;
      room = Math.min(room, g.r[i]! + (shine[j]! > 0 ? free / 2 : free));
    });
    grown.set(i, Math.max(g.r[i]!, room));
  }
  const ringOf = (i: number, rr: number) => (i === focus && S.hover_ring! > 0 ? Math.min(S.hover_ring! / cam.k, rr / 2) : 0);
  // An arrowhead at a link's `to`, its tip on that particle's edge as drawn: added to a path, filled after the lines.
  const alen = S.arrow_px! / cam.k, awide = (S.arrow_px! * 2) / 3 / cam.k, afrom = S.arrow_from_px! / cam.k;
  const head = (path: Path2D, e: number, grow = 1) => {
    const a = g.a[e]!, b = g.b[e]!, dx = g.x[a]! - g.x[b]!, dy = g.y[a]! - g.y[b]!;
    if (Math.hypot(dx, dy) < afrom) return;
    const rb = grown.get(b) ?? g.r[b]!;
    const back = (rb + ringOf(b, rb)) * (S.shapes ? edge(g.shape[b]!, Math.atan2(dy, dx)) : 1);
    const p = arrow(g.x[a]!, g.y[a]!, g.x[b]!, g.y[b]!, back, alen * grow, awide * grow);
    path.moveTo(p[0], p[1]);
    path.lineTo(p[2], p[3]);
    path.lineTo(p[4], p[5]);
    path.closePath();
  };
  for (let kind = 0; kind < g.linkKinds.length; kind++) for (const lit of match ? [0, 1] : [1]) {
    c.beginPath();
    const heads = new Path2D();
    for (let e = 0; e < g.m; e++) {
      if (g.kind[e] !== kind) continue;
      const a = g.a[e]!, b = g.b[e]!;
      if (match && (full(a) && full(b) ? 1 : 0) !== lit) continue;
      if (Math.max(g.x[a]!, g.x[b]!) < vx0 || Math.min(g.x[a]!, g.x[b]!) > vx1 || Math.max(g.y[a]!, g.y[b]!) < vy0 || Math.min(g.y[a]!, g.y[b]!) > vy1) continue;
      c.moveTo(g.x[a]!, g.y[a]!);
      c.lineTo(g.x[b]!, g.y[b]!);
      if (S.arrows) head(heads, e);
    }
    const strength = S.link_alpha! * (kind === partOf ? 1.4 : 1), dimmed = faint * (lit ? 1 : S.query_fade!);
    c.globalAlpha = strength * dimmed;
    c.strokeStyle = kind === partOf ? ink.muted : ink.line;
    c.stroke();
    // Heads stronger than their line, and fading less with it, so a faint link still says which way it goes.
    c.globalAlpha = Math.min(1, strength * S.arrow_strength!) * Math.max(dimmed, S.arrow_keep!);
    c.fillStyle = c.strokeStyle;
    c.fill(heads);
  }
  // The links between lit particles, strong, as lit as their fainter end.
  c.strokeStyle = ink.accent;
  c.lineWidth = (S.link_width! * S.hover_links!) / cam.k;
  for (const i of shining) for (const e of g.incident[i]!) {
    const j = g.a[e] === i ? g.b[e]! : g.a[e]!;
    if (j < i && shining.has(j)) continue;
    const s = Math.min(shine[i]!, shine[j]!);
    if (!s) continue;
    c.globalAlpha = 0.9 * s;
    c.beginPath();
    c.moveTo(g.x[i]!, g.y[i]!);
    c.lineTo(g.x[j]!, g.y[j]!);
    c.stroke();
    if (S.arrows) {
      const one = new Path2D();
      head(one, e, S.arrow_lit!);
      c.globalAlpha = s;
      c.fillStyle = ink.accent;
      c.fill(one);
    }
  }
  // Particles: the colour set once per type and openness, each circle filled on its own.
  for (let ty = 0; ty < g.types.length; ty++) {
    c.fillStyle = g.types[ty]!.colour;
    for (const [shut, hit] of [[1, 0], [0, 0], [1, 1], [0, 1]] as const) {
      if (!match && !hit) continue;
      for (let i = 0; i < g.n; i++) {
        if (g.typeIx[i] !== ty || g.closed[i] !== shut || !inView(i, g.r[i]!)) continue;
        if (match && full(i) !== hit) continue;
        // What the find line finds is drawn whole, closed or not: a plan's done steps still read.
        c.globalAlpha = (shut && match?.[i] !== FOUND ? S.closed_fade! : 1) * faint * (match && !hit ? S.query_fade! : 1) * come(i);
        particle(c, g, i, g.r[i]!, S, cam.k, ink.sea);
      }
    }
  }
  // Lit particles over the faded rest, at the size worked out above; the one pointed at gets a ring.
  for (const i of shining) {
    const rr = grown.get(i)!;
    c.globalAlpha = shine[i]!;
    c.fillStyle = g.types[g.typeIx[i]!]!.colour;
    particle(c, g, i, rr, S, cam.k, ink.sea);
    if (i === focus && S.hover_ring! > 0) {
      const lw = ringOf(i, rr);
      c.strokeStyle = ink.accent;
      c.lineWidth = lw;
      c.lineJoin = "round";
      c.beginPath();
      outline(c, S.shapes ? g.shape[i]! : CIRCLE, g.x[i]!, g.y[i]!, rr + lw / 2);
      c.stroke();
    }
  }
  // The particle a view picked: an accent ring, as the one pointed at has, so it is found without fading the rest.
  const p = light.picked;
  if (p >= 0 && p < g.n && S.hover_ring! > 0 && inView(p, g.r[p]!)) {
    const rr = grown.get(p) ?? g.r[p]!, lw = Math.min(S.hover_ring! / cam.k, rr / 2), gap = 2 / cam.k;
    c.globalAlpha = 1;
    c.strokeStyle = ink.accent;
    c.lineWidth = lw;
    c.lineJoin = "round";
    c.beginPath();
    outline(c, S.shapes && !g.types[g.typeIx[p]!]?.icon ? g.shape[p]! : CIRCLE, g.x[p]!, g.y[p]!, rr + gap + lw / 2);
    c.stroke();
  }

  // Words, in screen space (labels.ts places them): the lit first, then what the find line finds, then what was
  // named last frame, then hubs, then the largest; none over another word or particle, none off the view.
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.font = "11px ui-sans-serif, system-ui, sans-serif";
  const hub = light.hubs(g, S);
  // The rest's titles fade out as the light comes in (over dim_ms), and only go once it is all but in.
  const lit = light.dim > 0.98;
  const rest = 1 - light.dim;
  const rank = (i: number) =>
    (i === focus ? 64 : 0) + (shine[i]! > 0 ? 32 : 0) + (match?.[i] === FOUND ? 16 : 0) + (hub[i] ? 8 : 0) + (light.named.has(g.id[i]!) ? 4 : 0) + (g.closed[i] ? 0 : 2);
  const wants: number[] = [];
  for (let i = 0; i < g.n; i++) {
    if (!inView(i, 0) || quiet?.has(i)) continue;
    // While one is pointed at, only it and its neighbours are named; while the find line has words, what it finds,
    // then what is near it as room allows, never the faint edge.
    if (lit ? !(shine[i]! > 0.5) : match ? !(match[i] === FOUND || (full(i) && (g.r[i]! * cam.k >= S.label_px! || hub[i]))) : !(g.r[i]! * cam.k >= S.label_px! || hub[i])) continue;
    wants.push(i);
  }
  // Among equals, the more linked first: hubs by their links, the rest by their size.
  wants.sort((p, q) => rank(q) - rank(p) || (hub[p] && hub[q] ? g.degree[q]! - g.degree[p]! : 0) || g.r[q]! - g.r[p]! || p - q);
  const budget = Math.min(S.label_most!, Math.floor((width * height) / Math.max(1, S.label_room!)));
  const texts = new Map<number, string[]>();
  const LINE = 13;
  const want: Want[] = wants.slice(0, Math.max(budget * 4, 40)).map((i) => {
    const r = g.r[i]! * cam.k;
    // Wide enough: the title inside the particle, on as many lines as fit across it (at most three), the last cut with ….
    const rows = Math.min(3, Math.floor((2 * r * 0.75) / LINE));
    // An icon is drawn lines, not a filled shape: its title goes beside it, never over it.
    const lines = S.label_inside! > 0 && 2 * r >= S.label_inside! && rows >= 1 && !g.types[g.typeIx[i]!]?.icon ? wrap(c, clip(g.title[i]!, S.label_chars!), 2 * r * 0.8, rows) : [];
    // Lines of under four letters in all say nothing: then the title goes beside, whole.
    const inside = lines.join("").replace("…", "").length >= 4;
    const text = inside ? lines : [clip(g.title[i]!, S.label_chars!)];
    texts.set(i, text);
    const w = Math.max(...text.map((t) => c.measureText(t).width)) + 4;
    return { i, x: g.x[i]! * cam.k + cam.tx, y: g.y[i]! * cam.k + cam.ty, r, w, h: text.length * LINE + 1, must: shine[i]! > 0.5 || (!lit && !!hub[i]), inside, spot: light.spots.get(g.id[i]!) };
  });
  // Whether a box covers a particle other than i that is label_cover_px or more across on screen.
  const covers = (b: [number, number, number, number], i: number) => {
    let hit = false;
    grid.each((b[0] - cam.tx) / cam.k, (b[1] - cam.ty) / cam.k, (b[2] - cam.tx) / cam.k, (b[3] - cam.ty) / cam.k, (j) => {
      if (hit || j === i) return;
      const rs = g.r[j]! * cam.k;
      if (2 * rs < S.label_cover_px!) return;
      const cx = g.x[j]! * cam.k + cam.tx, cy = g.y[j]! * cam.k + cam.ty;
      const nx = Math.max(b[0], Math.min(cx, b[2])), ny = Math.max(b[1], Math.min(cy, b[3]));
      if (Math.hypot(cx - nx, cy - ny) < rs) hit = true;
    });
    return hit;
  };
  const placed = place(want, { width, height, room: S.label_room!, most: S.label_most!, gap: S.label_gap!, covers, clear });
  light.named = new Set(placed.map((p) => g.id[p.i]!));
  // A title that takes another spot fades out where it stood and in where it goes (label_move_ms).
  const moveMs = S.label_move_ms ?? 0;
  if (moveMs > 0) {
    const nowAt = new Map(placed.map((p) => [g.id[p.i]!, [g.x[p.i]! * cam.k + cam.tx, g.y[p.i]! * cam.k + cam.ty] as [number, number]]));
    for (const id of movedTitles(light.spots, placed.map((p) => [g.id[p.i]!, p.spot]), light.spotsAt, nowAt)) {
      light.movedAt.set(id, at);
      const old = light.labels.get(id);
      if (old) light.leaving.push({ label: old, at });
    }
  }
  // Where each title stands, in world units, so one that leaves the map fades where it was read (gone.ts).
  light.labels = new Map(placed.map((p) => [g.id[p.i]!, { x: ((p.within ? (p.box[0] + p.box[2]) / 2 : p.box[0] + 2) - cam.tx) / cam.k, y: (p.box[1] - cam.ty) / cam.k, lines: texts.get(p.i)!, center: !!p.within }]));
  light.spots = new Map(placed.map((p) => [g.id[p.i]!, p.spot]));
  light.spotsAt = new Map(placed.map((p) => [g.id[p.i]!, [g.x[p.i]! * cam.k + cam.tx, g.y[p.i]! * cam.k + cam.ty] as [number, number]]));
  const moved = (i: number) => {
    const t = light.movedAt.get(g.id[i]!);
    return t === undefined || !moveMs ? 1 : comeFade(at - t, moveMs);
  };
  c.strokeStyle = ink.sea;
  for (const { i, box, within } of placed) {
    const rs = g.r[i]! * cam.k;
    const grow = shine[i]! > 0 || match?.[i] === FOUND || hub[i] ? 1 : Math.min(1, 0.6 + (0.4 * (rs - S.label_px!)) / Math.max(0.1, S.label_fade!));
    // A closed item's title is muted, like its particle.
    const shut = g.closed[i] && !(shine[i]! > 0) && !within && match?.[i] !== FOUND;
    c.globalAlpha = grow * Math.max(faint * fade(i) * (shine[i]! > 0.5 ? 1 : rest), shine[i]!) * (shut ? 0.75 : 1) * come(i) * moved(i);
    c.fillStyle = shut ? ink.muted : ink.text;
    const lines = texts.get(i)!, mid = (box[0] + box[2]) / 2;
    c.textAlign = within ? "center" : "left";
    lines.forEach((line, k) => {
      const x = within ? mid : box[0] + 2, y = box[1] + LINE * (k + 0.5) + 0.5;
      if (S.label_halo! > 0) (c.lineWidth = S.label_halo!), c.strokeText(line, x, y);
      c.fillText(line, x, y);
    });
  }
  // The moved titles where they stood, fading out.
  let still = 0;
  for (const q of light.leaving) {
    const f = moveMs ? 1 - comeFade(at - q.at, moveMs) : 0;
    if (f <= 0) continue;
    light.leaving[still++] = q;
    c.globalAlpha = f * faint;
    c.fillStyle = ink.text;
    c.textAlign = q.label.center ? "center" : "left";
    const x = q.label.x * cam.k + cam.tx, top = q.label.y * cam.k + cam.ty;
    q.label.lines.forEach((line, k) => {
      const y = top + LINE * (k + 0.5) + 0.5;
      if (S.label_halo! > 0) (c.lineWidth = S.label_halo!), c.strokeText(line, x, y);
      c.fillText(line, x, y);
    });
  }
  light.leaving.length = still;
  for (const [id, t] of light.movedAt) if (at - t >= moveMs) light.movedAt.delete(id);
  light.labelsMoving = still > 0 || light.movedAt.size > 0;
  c.textAlign = "left";

  // Link names, along their middles, over nothing named: the lit first, then the longest on screen.
  // They grow and shrink with the zoom, and fade in and out as they gain or lose their room.
  const namePx = S.link_names && S.link_name_most! > 0 ? wireSize(S.link_name_size!, cam.k, S.link_name_least_px!, S.link_name_most_px!) : 0;
  if (!namePx && !light.wires.size) return void (light.wiresMoving = false);
  c.font = `${(namePx || S.link_name_least_px!).toFixed(1)}px ui-sans-serif, system-ui, sans-serif`;
  const sx = (i: number) => g.x[i]! * cam.k + cam.tx, sy = (i: number) => g.y[i]! * cam.k + cam.ty;
  const wires: WireWant[] = [];
  for (let e = 0; namePx && e < g.m; e++) {
    const a = g.a[e]!, b = g.b[e]!;
    if (match && !(full(a) && full(b))) continue;
    const on = shine[a]! > 0.5 && shine[b]! > 0.5;
    if (lit && !on) continue;
    if (!inView(a, 0) && !inView(b, 0)) continue;
    // Not lit: named only at the zoom where both ends' titles show, so the whole map is not buried in link names.
    if (!on && Math.min(g.r[a]!, g.r[b]!) * cam.k < S.label_px!) continue;
    wires.push({ e, x1: sx(a), y1: sy(a), x2: sx(b), y2: sy(b), w: c.measureText(wireName(g.linkKinds[g.kind[e]!]!, g.places?.[e])).width + 4, h: namePx + 2, lit: on });
  }
  const taken = [...clear, ...placed.map((p) => p.box as [number, number, number, number])];
  // The particles' own room at each end, so a name sits clear of both.
  const named = namePx ? placeWires(wires, { width, height, from: S.link_name_from_px!, most: S.link_name_most!, ends: 12, taken }) : [];
  light.easeWires(named, S.link_name_fade_ms!);
  c.textAlign = "center";
  c.lineWidth = S.label_halo!;
  for (const [e, w] of light.wires) {
    if (e >= g.m) continue;
    const a = g.a[e]!, b = g.b[e]!;
    c.globalAlpha = Math.max(faint, Math.min(shine[a]!, shine[b]!)) * 0.9 * w.a;
    c.fillStyle = ink.muted;
    c.save();
    c.translate(w.x, w.y);
    c.rotate(w.angle);
    const t = wireName(g.linkKinds[g.kind[e]!]!, g.places?.[e]);
    if (S.label_halo! > 0) c.strokeText(t, 0, 0);
    c.fillText(t, 0, 0);
    c.restore();
  }
  c.textAlign = "left";
}
