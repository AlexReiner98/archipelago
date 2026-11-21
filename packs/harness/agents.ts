/**
 * The agents round the tree, when every live run is watched at once.
 *
 * - `orbitOf`: an ellipse outside the tree and its names, where agents sit.
 * - `seatOf`: an agent's seat on it, fixed by its colour (one seat per hue,
 *   the first at the top), so an agent stays put while it is live.
 * - `flightOf`: how an event moves between a node and its agent. A say or a
 *   refusal leaves its node, runs out to the orbit and along it to the
 *   agent; a hold leaves its node and stops short; an act comes in from the
 *   agent to the bough of its place; a begin or an end pulses the agent.
 *   Out of the tree first and then round it, so traffic never crosses it.
 * - `placementOf`: the profile an agent is in, as a mark: matched, the
 *   workspace's fallback, or none.
 * - `ProfileMenu`: the profiles, to move an agent into one
 *   (`profile.place`); the page never writes itself.
 */
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import htm from "htm";
import type { ExchangeEvent } from "../../spec/exchange.ts";
import type { ProfileInfo } from "../../spec/profile.ts";
import { HUES, sheet } from "../../spec/style.ts";
import { lightOf, spotOf, type Placed, type Tree } from "./layout.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

export interface Orbit {
  rx: number;
  ry: number;
}
export interface Seat {
  x: number;
  y: number;
  /** Its angle on the orbit, in the ellipse's own frame. */
  a: number;
}
type Pt = [number, number];

/** The orbit: past the tree's bounds (names included) by `pad`. */
export function orbitOf(box: Placed["box"], pad = 70): Orbit {
  return { rx: Math.max(Math.abs(box.x), Math.abs(box.x + box.width)) + pad, ry: Math.max(Math.abs(box.y), Math.abs(box.y + box.height)) + pad };
}

/** The seat of colour slot `slot` of `slots`, the first at the top, the rest clockwise. */
export function seatOf(orbit: Orbit, slot: number, slots: number = HUES.length): Seat {
  const a = -Math.PI / 2 + (slot * 2 * Math.PI) / slots;
  return { a, x: Math.cos(a) * orbit.rx + 0, y: Math.sin(a) * orbit.ry + 0 };
}

/** The bounds of the tree and its orbit, agents' names under their seats included. */
export function orbitBox(orbit: Orbit, label = 130): Placed["box"] {
  return { x: -orbit.rx - label, y: -orbit.ry - 24, width: 2 * (orbit.rx + label), height: 2 * orbit.ry + 24 + 64 };
}

const STEP = 14;
const line = (a: Pt, b: Pt): Pt[] => {
  const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP));
  return Array.from({ length: n + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as Pt);
};

/** From a point in the tree out to the orbit, then round it the short way to the seat. */
export function flight(orbit: Orbit, from: { x: number; y: number }, seat: Seat): Pt[] {
  const a0 = from.x || from.y ? Math.atan2(from.y / orbit.ry, from.x / orbit.rx) : seat.a;
  const rim: Pt = [Math.cos(a0) * orbit.rx, Math.sin(a0) * orbit.ry];
  const out = line([from.x, from.y], rim);
  let d = seat.a - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const n = Math.max(1, Math.ceil((Math.abs(d) * Math.max(orbit.rx, orbit.ry)) / STEP));
  const arc = Array.from({ length: n }, (_, i) => {
    const a = a0 + (d * (i + 1)) / n;
    return [Math.cos(a) * orbit.rx, Math.sin(a) * orbit.ry] as Pt;
  });
  return [...out, ...arc];
}

export interface Flight {
  /** out: node to agent; in: agent to the place; hold: out and stopping short; pulse: at the agent only. */
  way: "out" | "in" | "hold" | "pulse";
  points: Pt[];
  tone: "say" | "fail" | "write" | "hold";
  /** The tree node it leaves or lands on. */
  at?: string;
}

/** How an event moves between the tree and its agent's seat. Nothing when it has no place in the tree. */
export function flightOf(tree: Tree, placed: Placed, orbit: Orbit, seat: Seat, e: Pick<ExchangeEvent, "kind" | "node" | "place" | "act">): Flight | undefined {
  if (e.kind === "begin" || e.kind === "end") return { way: "pulse", points: [[seat.x, seat.y]], tone: "say" };
  if (e.kind === "gated") {
    const at = e.node && tree.byId.has(e.node) ? e.node : spotOf(tree, e.place).id;
    const p = placed.xy.get(at);
    if (!p) return undefined;
    const pts = flight(orbit, p, seat);
    // Out of the tree, and no further: it never reached the agent.
    const rim = pts.findIndex(([x, y]) => (x / orbit.rx) ** 2 + (y / orbit.ry) ** 2 >= 0.999);
    return { way: "hold", points: pts.slice(0, Math.max(2, Math.ceil((rim < 0 ? pts.length : rim + 1) * 0.6))), tone: "hold", at };
  }
  const l = lightOf(tree, e);
  if (!l) return undefined;
  const p = placed.xy.get(l.at);
  if (!p) return undefined;
  const pts = flight(orbit, p, seat);
  if (e.kind === "say" || e.kind === "refuse") return { way: "out", points: pts, tone: l.tone, at: l.at };
  return { way: "in", points: pts.reverse(), tone: l.tone, at: l.at };
}

/** Where an agent stands among profiles. */
export interface Placement {
  kind: "matched" | "fallback" | "none";
  /** The profiles it matched, by title. */
  title: string;
  /** Every profile it is in, parts included. */
  ids: string[];
}

/** An agent's placement: in a profile it matches; only in the fallback, unless it named it itself; or in none. */
export function placementOf(ps: ProfileInfo[], fallbacks: ReadonlySet<string>, said: readonly string[] = []): Placement {
  const matched = ps.filter((p) => p.by === "match");
  if (!matched.length) return { kind: "none", title: "", ids: [] };
  const fallback = matched.every((p) => fallbacks.has(p.id) && !said.includes(p.id));
  return { kind: fallback ? "fallback" : "matched", title: matched.map((p) => p.title).join(", "), ids: ps.map((p) => p.id) };
}

export const PLACEMENT_MARK: Record<Placement["kind"], string> = { matched: "●", fallback: "○", none: "–" };
export const placementText = (p: Placement) => `${PLACEMENT_MARK[p.kind]} ${p.kind === "none" ? "no profile" : p.title}`;
export const placementTip = (p: Placement) =>
  p.kind === "matched" ? `In ${p.title}, by its facts or its own say` : p.kind === "fallback" ? `In ${p.title}: the fallback, as nothing else placed it` : "In no profile: it hears every node";

export const AGENTS_STYLE = sheet(`
.rx-agent { cursor:pointer; }
.rx-agent .dot { stroke:var(--bg); stroke-width:2; }
.rx-agent .halo { fill:none; stroke-width:1.5; opacity:0; }
.rx-agent.ping .halo { animation:rx-ping .9s ease-out; }
@keyframes rx-ping { from { opacity:.9; r:10px; } to { opacity:0; r:32px; } }
.rx-agent.quiet { opacity:.45; }
.rx-agent .who { fill:var(--fg); font:var(--bold) 16px var(--font); text-anchor:middle; }
.rx-agent .prof { fill:var(--dim); font:400 14px var(--font); text-anchor:middle; }
.rx-agent .prof.none { font-style:italic; }
.rx-agent:hover .who { fill:var(--pick); }
.rx-flight { fill:none; stroke-width:2; stroke-linecap:round; stroke-linejoin:round; pointer-events:none; }
.rx-mote { pointer-events:none; }
.hv-menu { position:absolute; z-index:4; min-width:180px; max-width:280px; padding:var(--space-1) 0; background:var(--panel); border:1px solid var(--line); border-radius:var(--radius); box-shadow:0 6px 20px color-mix(in srgb, var(--bg) 60%, transparent); }
.hv-menu .h { padding:var(--space-1) var(--space-3); color:var(--dim); font-size:var(--text-xs); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.hv-menu .o { display:flex; gap:var(--space-2); align-items:baseline; padding:var(--space-1) var(--space-3); cursor:pointer; white-space:nowrap; }
.hv-menu .o:hover { background:color-mix(in srgb, var(--line) 50%, transparent); }
.hv-menu .o .x { overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0; }
.hv-menu .o.on { color:var(--pick); }
.hv-menu .o .m { color:var(--dim); width:1em; flex:none; text-align:center; }
.hv-menu .err { padding:var(--space-1) var(--space-3); color:var(--failed); white-space:normal; font-size:var(--text-s); }
`);

export interface MenuProfile {
  id: string;
  title: string;
  status: string;
  fallback?: boolean;
}

/** The profiles, for one agent: a click moves it into that one. Closes on Esc or a click outside. */
export const ProfileMenu = ({ x, y, title, profiles, current, error, onPick, onClose }: { x: number; y: number; title: string; profiles: MenuProfile[]; current: readonly string[]; error?: string; onPick(id: string): void; onClose(): void }) => {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && onClose();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", away, true);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("pointerdown", away, true);
      window.removeEventListener("keydown", esc);
    };
  }, []);
  return html`<div class="hv-menu" ref=${box} style=${`left:${x}px;top:${y}px`}>
    <div class="h" title=${title}>Move ${title} to</div>
    ${profiles.map((p) => html`<div class=${`o${current.includes(p.id) ? " on" : ""}`} title=${`${p.status}${p.fallback ? " · the fallback" : ""}`} onClick=${() => onPick(p.id)}>
      <span class="m">${p.status === "on" ? "●" : p.status === "off" ? "○" : "◌"}</span><span class="x">${p.title}</span>${p.fallback && html`<span class="hv-dim">fallback</span>`}
    </div>`)}
    ${!profiles.length && html`<div class="h">No profiles on the map.</div>`}
    ${error && html`<div class="err">${error}</div>`}
  </div>`;
};
