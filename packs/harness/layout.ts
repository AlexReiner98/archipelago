/**
 * The harness tree's shape, as pure functions: no page, no capabilities.
 *
 * - `treeOf`: every node from `agent.tree` hung under one root. By place,
 *   each node hangs from boughs named for its first place, the general
 *   nearest the root (tool, then the MCP server, then the tool; file, then
 *   its top folders; memory, then its scope; skill, then each part of its
 *   name). By pack, from its pack and then its kind. A bough below the
 *   first level with one kid only is folded into it. A node said nowhere
 *   (`at: []`) hangs from "never said", or is left out.
 * - `radial`: each subtree gets a share of the circle by its leaves, a ring
 *   out for each level, spread wider than tall. The ring grows until no two
 *   leaves' names overlap. Each branch is an S-curve out of its parent.
 * - `route` and `spotOf`: where a light runs, and where an act lands.
 *
 * The design is the old reflex_view pack's (its lens "Reflex tree"), cut
 * down to what the exchange records.
 */
import type { NodeInfo, Place } from "../../spec/agent.ts";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import { HUES, v } from "../../spec/style.ts";
import { channelOf, channelTitle, isHarness } from "./channels.ts";

export interface Bough {
  key: string;
  title: string;
}

export interface TreeNode {
  /** A leaf's node id (`pack/name`); a bough's `~:<key>`; the root's `~root`. */
  id: string;
  title: string;
  depth: number;
  parent?: TreeNode;
  kids: TreeNode[];
  /** Set on a leaf: the node it draws. */
  node?: NodeInfo;
  /** Set on a leaf of the "decided" bough: the node kept (`up`) or retired. */
  decided?: { node: string; up: boolean };
}

export interface Tree {
  root: TreeNode;
  byId: Map<string, TreeNode>;
  /** Root first, each node before its kids. */
  order: TreeNode[];
  /** Nodes said nowhere that were left out. */
  hidden: number;
}

export type Grouping = "place" | "pack" | "profile" | "channel";

export interface TreeOptions {
  by?: Grouping;
  /** How many top folders of a file glob become boughs. */
  fileDepth?: number;
  /** At most this many boughs between the root and a node. */
  placeDepth?: number;
  /** Show nodes said nowhere, under "never said". */
  unsaid?: boolean;
  /** By profile: the profiles each node comes from, nearest first; its first is its bough. */
  profiles?: Map<string, string[]>;
  /** Nodes kept or retired (the keep pack's), each a leaf of one "decided" bough; retired ones are loaded no more. */
  decided?: { node: string; title: string; up: boolean }[];
}

export const ROOT = "~root";
/** The bough of nodes kept or retired. */
export const DECIDED = "~decided";
const NEVER: Bough = { key: "never", title: "never said" };
const GLOB = /[*?[{]/;
const words = (s: string) => s.replaceAll("_", " ");

/** The boughs a place is said under, general first. */
export function boughsOf(place: Place | undefined, fileDepth = 2, most = 4): Bough[] {
  if (!place) return [];
  const colon = place.indexOf(":");
  const kind = colon < 0 ? place : place.slice(0, colon);
  const tail = colon < 0 ? "" : place.slice(colon + 1);
  const out: Bough[] = [{ key: kind, title: words(kind) }];
  if (tail && kind === "file") {
    const folders = tail.split("/").slice(0, -1);
    const glob = folders.findIndex((f) => GLOB.test(f));
    const plain = glob < 0 ? folders : folders.slice(0, glob);
    plain.slice(0, Math.max(0, fileDepth)).forEach((f, i) => out.push({ key: `file:${plain.slice(0, i + 1).join("/")}/`, title: `${f}/` }));
  } else if (tail && (kind === "tool" || kind === "tool_result")) {
    const mcp = /^mcp__(.+?)__(.+)$/.exec(tail);
    if (mcp) out.push({ key: `${kind}:mcp__${mcp[1]}`, title: mcp[1]! }, { key: `${kind}:${tail}`, title: mcp[2]! });
    else out.push({ key: `${kind}:${tail}`, title: tail === "*" ? "any tool" : tail });
  } else if (tail && kind === "memory") {
    const scope = tail.split("/")[0]!;
    out.push({ key: `memory:${scope}`, title: scope });
  } else if (tail) {
    tail.split(":").forEach((part, i, all) => out.push({ key: `${kind}:${all.slice(0, i + 1).join(":")}`, title: words(part) }));
  }
  return out.slice(0, Math.max(1, most));
}

/** The boughs a node hangs from. */
function boughsFor(n: NodeInfo, o: Required<TreeOptions>): Bough[] | undefined {
  if (o.by === "channel") {
    // How it reaches the agent, then who it is from: the harness (who said it) or the map's pack.
    const c = channelOf(n);
    const who = isHarness(n) ? ((n as NodeInfo & { by?: string }).by ?? "the harness") : n.pack;
    return [{ key: `channel:${c}`, title: channelTitle(c) }, { key: `channel:${c}:${isHarness(n) ? "h" : "m"}:${who}`, title: who }];
  }
  if (o.by === "pack") return [{ key: `pack:${n.pack}`, title: n.pack }, { key: `pack:${n.pack}:${n.kind}`, title: words(n.kind) }];
  if (o.by === "profile") {
    const from = o.profiles.get(n.id)?.[0] ?? "no profile";
    return [{ key: `profile:${from}`, title: from }, { key: `profile:${from}:${n.kind}`, title: words(n.kind) }];
  }
  if (!n.at.length) return o.unsaid ? [NEVER] : undefined;
  return boughsOf(n.at[0], o.fileDepth, o.placeDepth);
}

/** Every node under one root. The same nodes make the same tree, whatever order they come in. */
export function treeOf(nodes: NodeInfo[], options: TreeOptions = {}): Tree {
  const o: Required<TreeOptions> = { by: "place", fileDepth: 2, placeDepth: 4, unsaid: false, profiles: new Map(), decided: [], ...options };
  const root: TreeNode = { id: ROOT, title: "agent", depth: 0, kids: [] };
  const byId = new Map<string, TreeNode>([[ROOT, root]]);
  let hidden = 0;
  for (const n of [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const boughs = boughsFor(n, o);
    if (!boughs) {
      hidden++;
      continue;
    }
    let parent = root;
    for (const b of boughs) {
      const id = `~:${b.key}`;
      let bough = byId.get(id);
      if (!bough) {
        bough = { id, title: b.title, depth: parent.depth + 1, parent, kids: [] };
        byId.set(id, bough);
        parent.kids.push(bough);
      }
      parent = bough;
    }
    if (byId.has(n.id)) continue;
    const leaf: TreeNode = { id: n.id, title: n.title, depth: parent.depth + 1, parent, kids: [], node: n };
    byId.set(n.id, leaf);
    parent.kids.push(leaf);
  }
  if (o.decided.length) {
    const bough: TreeNode = { id: DECIDED, title: "decided", depth: 1, parent: root, kids: [] };
    byId.set(DECIDED, bough);
    root.kids.push(bough);
    for (const d of o.decided) {
      const id = `~d:${d.node}`;
      if (byId.has(id)) continue;
      const leaf: TreeNode = { id, title: d.title, depth: 2, parent: bough, kids: [], decided: { node: d.node, up: d.up } };
      byId.set(id, leaf);
      bough.kids.push(leaf);
    }
  }
  // A bough below the first level that holds one thing only says its name twice: its kid takes its place.
  const fold = (t: TreeNode) => {
    t.kids = t.kids.map((k) => {
      let kid = k;
      while (!kid.node && kid.depth > 1 && kid.kids.length === 1) {
        byId.delete(kid.id);
        kid = kid.kids[0]!;
      }
      kid.parent = t;
      fold(kid);
      return kid;
    });
  };
  fold(root);
  // Boughs before leaves; each by its title, so neighbours read in order round the circle.
  const order: TreeNode[] = [];
  const walk = (t: TreeNode) => {
    t.depth = t.parent ? t.parent.depth + 1 : 0;
    t.kids.sort((a, b) => Number(!!(a.node ?? a.decided)) - Number(!!(b.node ?? b.decided)) || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
    order.push(t);
    t.kids.forEach(walk);
  };
  walk(root);
  return { root, byId, order, hidden };
}

/** The deepest bough a place has in the tree: where an act at it lands. The root if none. */
export function spotOf(tree: Tree, place: Place | undefined, fileDepth = 2, most = 4): TreeNode {
  let at = tree.root;
  for (const b of boughsOf(place, fileDepth, most)) {
    // A bough folded into its one kid is skipped; a deeper one may still stand.
    const t = tree.byId.get(`~:${b.key}`);
    if (t) at = t;
  }
  return at;
}

// ---------- radial ----------

export interface Label {
  text: string;
  /** Rotation of the text, in degrees, so it reads left to right. */
  turn: number;
  /** Offset along the rotated text's line, and across it. */
  dx: number;
  dy: number;
  anchor: "start" | "end";
}

export interface Placed {
  /** Each node's place, in the picture's units. */
  xy: Map<string, { x: number; y: number }>;
  polar: Map<string, { a: number; r: number }>;
  /** Each node's branch from its parent, an SVG path. */
  branch: Map<string, string>;
  /** The same curve as points, for a light to run along it. */
  along: Map<string, [number, number][]>;
  labels: Map<string, Label>;
  ring: number;
  /** The picture's bounds, names included: x, y, width, height. */
  box: { x: number; y: number; width: number; height: number };
}

export interface RadialOptions {
  /** The least gap between rings. */
  ring?: number;
  /** The most it may grow to fit names. */
  ringMost?: number;
  /** Wider than tall by this much. */
  spreadX?: number;
  /** A name's height, its gap from its dot, and its most letters. */
  nameText?: number;
  nameGap?: number;
  nameMost?: number;
  nameLift?: number;
  margin?: number;
  curveSteps?: number;
  /** A text's width at a size. */
  measure?: (text: string, size: number) => number;
}

/** The numbers from the old lens "Reflex tree". */
export const STYLE = {
  ring: 60,
  ringMost: 260,
  spreadX: 1.3,
  nameText: 11,
  nameGap: 8,
  nameMost: Infinity,
  nameLift: 0.75,
  margin: 50,
  curveSteps: 10,
  node: 3,
  leaf: 2.5,
  root: 7,
  hit: 8,
  branch: 3.2,
  branchStep: 0.45,
  branchLeast: 0.8,
  branchInk: 0.72,
  branchFade: 0.06,
  branchFaint: 0.2,
  pulse: 0.95,
  flashTime: 0.35,
  light: 8,
  flash: 24,
  head: 2.5,
  trail: 2.2,
  trailInk: 0.6,
  spark: 4,
  sparkGrow: 18,
  sparkLife: 0.9,
  glow: 0.25,
  linger: 1.5,
  /** Colours are the style's tokens (spec/style.md), each with its plain fallback. */
  colors: { write: v("write"), say: v("say"), fail: v("failed"), fire: v("fire"), owner: v("owner"), learned: v("learned"), schema: v("schema") },
  hues: HUES.map(v),
};

/** A word that is a path: it has a slash or a backslash in it, or starts at home (`~`). */
const isPath = (w: string) => /[\\/]/.test(w) || w.startsWith("~");

/** Folders that say nothing about whose a path is. */
const PLAIN = new Set(["~", ".", "..", ".claude", "projects", "memory", "documents", "github", "desktop", "repos", "src", "code", "dev", "work", "users", "home"]);
/** Claude's own folders: never where a path is. */
const STRUCT = new Set(["~", ".", "..", ".claude", "projects", "memory"]);
/** Files every project has: named by their project alone. */
const USUAL = new Set(["claude.md", "claude.local.md", "memory.md", "agents.md"]);

/**
 * Whose a path is, in a word or two: the project's folder, and the file
 * when it isn't the usual one. Claude's own `~/.claude/projects/<folder,
 * its slashes as dashes>` gives back the folder's last name.
 */
export function placeName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const file = parts.length && /\.[a-z0-9]+$/i.test(parts[parts.length - 1]!) ? parts.pop()! : undefined;
  const folders = parts
    .map((p) => (/^[a-z]--/i.test(p) ? decodeFolder(p) : p))
    .filter((p) => !PLAIN.has(p.toLowerCase()) && !/^[a-z]:$/i.test(p));
  // Only plain folders (a CLAUDE.md in Documents): the last of them still says where.
  const where = folders[folders.length - 1] ?? parts.filter((p) => !STRUCT.has(p.toLowerCase()) && !/^[a-z]:$/i.test(p)).pop();
  const extra = file && !USUAL.has(file.toLowerCase()) ? file : undefined;
  return [where, extra].filter(Boolean).join(" ") || file || path;
}

/** `C--Users-me-Documents-Github-archipelago-next` → `archipelago-next`: past the drive, the user and the plain folders. */
function decodeFolder(seg: string): string {
  let rest = seg.replace(/^[a-z]--/i, "").replace(/^(users|home)-[^-]+-/i, "");
  for (let again = true; again; ) {
    again = false;
    for (const p of PLAIN) {
      if (rest.toLowerCase().startsWith(`${p}-`)) {
        rest = rest.slice(p.length + 1);
        again = true;
      }
    }
  }
  return rest;
}

/**
 * A node's name as the tree shows it: never a path. Each path in it is said
 * as whose it is (`placeName`), after a dot: "project memory ·
 * archipelago-next". The whole title is in the tooltip.
 */
export function nameOf(title: string): string {
  const words = title.split(/\s+/).filter(Boolean);
  const plain = words.filter((w) => !isPath(w));
  const places = words.filter(isPath).map(placeName);
  if (!places.length) return plain.join(" ");
  return plain.length ? `${plain.join(" ")} · ${places.join(", ")}` : places.join(", ");
}

/** A text cut to `most` letters, the cut marked. */

export const cut = (text: string, most: number) => (text.length <= most ? text : `${text.slice(0, Math.max(1, most - 1))}…`);

/** About the width of a sans-serif text. */
export const roughWidth = (text: string, size: number) => text.length * size * 0.56;

/** How many leaves each subtree holds. */
export function leavesOf(tree: Tree): Map<string, number> {
  const out = new Map<string, number>();
  const count = (t: TreeNode): number => {
    const c = t.kids.length ? t.kids.reduce((s, k) => s + count(k), 0) : 1;
    out.set(t.id, c);
    return c;
  };
  count(tree.root);
  return out;
}

/** The angle each node stands at (its share's middle) and the share it has, the first at the top. */
export function anglesOf(tree: Tree): Map<string, { a: number; span: number }> {
  const leaves = leavesOf(tree);
  const out = new Map([[tree.root.id, { a: -Math.PI / 2, span: Math.PI * 2 }]]);
  const share = (t: TreeNode, from: number, span: number) => {
    let cur = from;
    for (const k of t.kids) {
      const s = (span * leaves.get(k.id)!) / leaves.get(t.id)!;
      out.set(k.id, { a: cur + s / 2, span: s });
      share(k, cur, s);
      cur += s;
    }
  };
  share(tree.root, -Math.PI / 2, Math.PI * 2);
  return out;
}

/** The ring that keeps every leaf's name clear of its neighbours': a leaf's arc at least a name tall. */
export function ringFor(tree: Tree, o: { ring: number; ringMost: number; nameText: number }): number {
  const angles = anglesOf(tree);
  let ring = o.ring;
  for (const t of tree.order) if (t.parent && !t.kids.length) ring = Math.max(ring, (o.nameText * 1.15) / (angles.get(t.id)!.span * t.depth));
  return Math.min(Math.max(o.ring, o.ringMost), ring);
}

/** Where everything stands. The same tree is placed the same each time. */
export function radial(tree: Tree, options: RadialOptions = {}): Placed {
  const o = { ...STYLE, measure: roughWidth, ...options };
  const sx = o.spreadX;
  const angles = anglesOf(tree);
  const ring = ringFor(tree, o);
  const polar = new Map<string, { a: number; r: number }>();
  for (const t of tree.order) polar.set(t.id, { a: angles.get(t.id)!.a, r: ring * t.depth });
  // `+ 0` keeps the root at 0, not -0.
  const at = (a: number, r: number): [number, number] => [Math.cos(a) * r * sx + 0, Math.sin(a) * r + 0];
  const xy = new Map([...polar].map(([id, p]) => {
    const [x, y] = at(p.a, p.r);
    return [id, { x, y }];
  }));
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const pt = (a: number, r: number) => at(a, r).map(r1).join(" ");

  const branch = new Map<string, string>();
  const along = new Map<string, [number, number][]>();
  const steps = Math.max(1, o.curveSteps);
  for (const t of tree.order) {
    if (!t.parent) continue;
    const p = polar.get(t.parent.id)!, c = polar.get(t.id)!, half = (c.r - p.r) / 2;
    const ends: [number, number][] = [[p.a, p.r], t.parent === tree.root ? [c.a, half] : [p.a, p.r + half], [c.a, c.r - half], [c.a, c.r]];
    branch.set(t.id, `M${pt(...ends[0]!)} C${pt(...ends[1]!)} ${pt(...ends[2]!)} ${pt(...ends[3]!)}`);
    const [p0, p1, p2, p3] = ends.map(([a, r]) => at(a, r)) as [number, number][];
    along.set(t.id, Array.from({ length: steps + 1 }, (_, i) => {
      const u = i / steps, v = 1 - u, w = [v * v * v, 3 * v * v * u, 3 * v * u * u, u * u * u] as const;
      return [0, 1].map((k) => w[0] * p0![k]! + w[1] * p1![k]! + w[2] * p2![k]! + w[3] * p3![k]!) as [number, number];
    }));
  }

  // Names along their rays: a leaf's outward from its dot, a bough's inward, lifted off its branch.
  const labels = new Map<string, Label>();
  const ends: [number, number][] = [...xy.values()].map((p) => [p.x, p.y]);
  for (const t of tree.order) {
    if (!t.parent) continue;
    const p = polar.get(t.id)!, here = xy.get(t.id)!;
    const ray = Math.atan2(Math.sin(p.a), Math.cos(p.a) * sx);
    const ux = Math.cos(ray), uy = Math.sin(ray);
    const right = ux >= -1e-9;
    const text = cut(nameOf(t.title), o.nameMost);
    const wide = o.measure(text, o.nameText);
    const out = t.kids.length ? -1 : 1;
    const lift = out > 0 ? 0 : -o.nameText * o.nameLift;
    // Text reads left to right: on the left half it turns half round, and runs the other way.
    const flip = right ? 1 : -1;
    labels.set(t.id, {
      text,
      turn: r1(((right ? ray : ray > 0 ? ray - Math.PI : ray + Math.PI) * 180) / Math.PI),
      dx: out * flip * o.nameGap,
      dy: lift,
      anchor: out * flip > 0 ? "start" : "end",
    });
    // Its far corners count in the bounds.
    const from = out > 0 ? o.nameGap : -(o.nameGap + wide), to = out > 0 ? o.nameGap + wide : -o.nameGap;
    for (const along of [from, to]) for (const side of [lift - o.nameText / 2, lift + o.nameText / 2]) {
      const s = side * flip;
      ends.push([here.x + ux * along - uy * s, here.y + uy * along + ux * s]);
    }
  }
  const xs = ends.map((e) => e[0]), ys = ends.map((e) => e[1]);
  const x0 = Math.min(...xs) - o.margin, y0 = Math.min(...ys) - o.margin;
  const box = { x: r1(x0), y: r1(y0), width: r1(Math.max(...xs) + o.margin - x0), height: r1(Math.max(...ys) + o.margin - y0) };
  return { xy, polar, branch, along, labels, ring, box };
}

/** The points a light runs along, root first, to a node. */
export function route(tree: Tree, placed: Placed, id: string): [number, number][] {
  const chain: TreeNode[] = [];
  for (let t = tree.byId.get(id); t?.parent; t = t.parent) chain.push(t);
  return chain.reverse().flatMap((t, i) => (i ? placed.along.get(t.id)!.slice(1) : placed.along.get(t.id)!));
}

/** A point part way along a route, `u` from 0 to 1. */
export function pointAt(points: [number, number][], u: number): [number, number] {
  if (!points.length) return [0, 0];
  const last = points.length - 1;
  const head = Math.max(0, Math.min(1, u)) * last;
  const k = Math.min(last - 1, Math.floor(head));
  if (k < 0) return points[0]!;
  const f = head - k, a = points[k]!, b = points[k + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
}

/** The bounds of the dots only, past them by `margin`: what a small tree fits, its names mostly hidden. */
export function dotsBox(placed: Placed, margin = 40): Placed["box"] {
  let x0 = 0, y0 = 0, x1 = 0, y1 = 0;
  for (const p of placed.xy.values()) (x0 = Math.min(x0, p.x)), (y0 = Math.min(y0, p.y)), (x1 = Math.max(x1, p.x)), (y1 = Math.max(y1, p.y));
  return { x: x0 - margin, y: y0 - margin, width: x1 - x0 + 2 * margin, height: y1 - y0 + 2 * margin };
}

/**
 * Each pack's hue: the map's words are the owner's, what grow learned its
 * own, every other pack the next hue. `hue-2` is left out: it is close to
 * the `harness` orange, which says Claude Code gave a node, not the map.
 */
export function packHues(packs: string[], style = STYLE): Map<string, string> {
  let next = 0;
  const hues = style.hues.filter((_, i) => i !== NOT_HUE);
  return new Map(
    [...new Set(packs)].sort().map((p) => [p, p === "words" ? style.colors.owner : p === "grow" ? style.colors.learned : hues[next++ % hues.length]!]),
  );
}
/** The pack hue too near the harness's orange (hue-2, by its place in HUES). */
const NOT_HUE = 1;

/** A branch's stroke at a depth: thick and strong at the root, fine and faint at the edge. */
export function branchAt(depth: number, s = STYLE): { width: number; ink: number } {
  return { width: Math.max(s.branchLeast, s.branch - (depth - 1) * s.branchStep), ink: Math.max(s.branchFaint, s.branchInk - (depth - 1) * s.branchFade) };
}

/** What lights for an event: a light along the way to a node, or a spark on a bough. */
export function lightOf(tree: Tree, e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">): { kind: "light" | "spark"; at: string; tone: "say" | "fail" | "write" } | undefined {
  if ((e.kind === "say" || e.kind === "refuse") && e.node) {
    const tone = e.kind === "say" ? "say" : "fail";
    return tree.byId.has(e.node) ? { kind: "light", at: e.node, tone } : { kind: "spark", at: spotOf(tree, e.place).id, tone };
  }
  if (e.kind === "act") return { kind: "spark", at: spotOf(tree, e.place).id, tone: e.act?.ok === false ? "fail" : "write" };
  if (e.kind === "miss") return { kind: "spark", at: spotOf(tree, e.place).id, tone: "fail" };
  if (e.kind === "begin" || e.kind === "end") return { kind: "spark", at: tree.root.id, tone: "say" };
  return undefined;
}
