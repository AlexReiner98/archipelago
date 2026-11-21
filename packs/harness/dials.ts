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

