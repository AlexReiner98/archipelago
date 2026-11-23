/**
 * The harness's dials, in the bar's ⋯ menu: how long a switch of focus
 * takes (trees.ts), one row each, ↺ to put it back. Their values
 * are the page key `harness.dials`, so an agent can set them; the browser
 * remembers them.
 */
import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import htm from "htm";
import type { HereRead, HereSet } from "../../spec/here.ts";
import { sheet } from "../../spec/style.ts";
export interface Dial {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  doc: string;
}

export const DIALS: readonly Dial[] = [
  { key: "switch_s", label: "switch s", min: 0, max: 1.5, step: 0.05, value: 0.4, doc: "Seconds a tree takes to grow into focus while the old one shrinks into the column; 0 switches at once." },
  { key: "tip_ms", label: "words after ms", min: 0, max: 3000, step: 50, value: 600, doc: "How long the pointer rests on a node or a bough before its words show beside it; 0 shows none." },
  { key: "name_steps", label: "name sizes", min: 0, max: 16, step: 1, value: 4, doc: "While the tree zooms, its names are drawn at this many sizes for each doubling, not at every size the zoom passes, so the letters drawn for one frame serve the next; they settle to their true size when it stops. 0 draws every size." },
  { key: "quiet_px", label: "all names from px", min: 0, max: 16, step: 0.5, value: 0, doc: "Below this size on screen, a node's name shows only if the run said it, refused with it, or it is picked: a tree seen whole reads by its shape and what it was told, and every name comes back as it zooms in. 0 shows every name." },
  { key: "quiet_min", label: "live for min", min: 1, max: 240, step: 1, value: 15, doc: "Minutes a run may go unheard and still be live; past it, it is a past run in the list, not an agent in the previews." },
];

export type Dials = Record<string, number>;

/** The dials' values: each one given, within its range; else where it starts. */
export function dialsOf(given: unknown): Dials {
  const g = given && typeof given === "object" ? (given as Record<string, unknown>) : {};
  return Object.fromEntries(DIALS.map((d) => {
    const x = g[d.key];
    return [d.key, typeof x === "number" && Number.isFinite(x) ? Math.min(d.max, Math.max(d.min, x)) : d.value];
  }));
}

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/** The page key that holds the dials' values (the harness pack's own). */
export const DIALS_KEY = "harness.dials";
const REMEMBER = "archipelago.harness.dials";

export const DIALS_STYLE = sheet(`
.hv-dials { padding:var(--space-2) 0; overflow:auto; height:100%; box-sizing:border-box; }
.hv-dial { display:grid; grid-template-columns:6.5em 1fr 3.2em 1em; gap:var(--space-2); align-items:center; padding:1px var(--space-4); white-space:nowrap; }
.hv-dial .k { color:var(--dim); overflow:hidden; text-overflow:ellipsis; }
.hv-dial input { width:100%; min-width:0; margin:0; accent-color:var(--pick); }
.hv-dial .n { font-variant-numeric:tabular-nums; text-align:right; }
.hv-dial button { font:inherit; background:none; border:0; padding:0; color:var(--pick); cursor:pointer; }
.hv-dial.moved .k { color:var(--fg); }
`);

/** What the browser kept, if it can keep anything. */
export function remembered(): unknown {
  try {
    const s = localStorage.getItem(REMEMBER);
    return s ? JSON.parse(s) : undefined;
  } catch {
    return undefined;
  }
}

/** The dials' values, kept live: the page key, else what the browser kept, else where they start. */
export function useDials(here: HereRead): Dials {
  const [d, setD] = useState(() => dialsOf(here.get(DIALS_KEY) ?? remembered()));
  useEffect(() => here.watch(DIALS_KEY, (c) => setD(dialsOf(c.value ?? remembered()))) as () => void, []);
  return d;
}

/** The panel: a row per dial. */
export const DialsPane = ({ here, set }: { here: HereRead; set: HereSet }) => {
  const d = useDials(here);
  const put = (key: string, value: number | undefined) => {
    const next: Dials = { ...d };
    const start = DIALS.find((x) => x.key === key)!.value;
    next[key] = value ?? start;
    const moved = Object.fromEntries(DIALS.filter((x) => next[x.key] !== x.value).map((x) => [x.key, next[x.key]!]));
    set.set(DIALS_KEY, moved);
    try {
      localStorage.setItem(REMEMBER, JSON.stringify(moved));
    } catch {
      // The browser keeps nothing here; the page key still holds them.
    }
  };
  return html`<div class="hv-dials">
    ${DIALS.map((x) => {
      const val = d[x.key]!;
      const moved = val !== x.value;
      return html`<label class=${`hv-dial${moved ? " moved" : ""}`} title=${x.doc}>
        <span class="k">${x.label}</span>
        <input type="range" min=${x.min} max=${x.max} step=${x.step} value=${val} onInput=${(e: Event) => put(x.key, Number((e.target as HTMLInputElement).value))} />
        <span class="n">${val}</span>
        ${moved ? html`<button title="Put it back" onClick=${(e: Event) => (e.preventDefault(), put(x.key, undefined))}>↺</button>` : html`<span></span>`}
      </label>`;
    })}
  </div>`;
};

