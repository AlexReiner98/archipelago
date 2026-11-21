/**
 * The agents, when every live run is watched at once: each with a tree of
 * its own (trees.ts).
 *
 * - `placementOf`: the profile an agent is in, as a mark: matched, the
 *   workspace's fallback, or none.
 * - `ProfileMenu`: the profiles, to move an agent into one
 *   (`profile.place`); the page never writes itself.
 */
import { h } from "preact";
import { useEffect, useRef } from "preact/hooks";
import htm from "htm";
import type { ProfileInfo } from "../../spec/profile.ts";
import { sheet } from "../../spec/style.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

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
