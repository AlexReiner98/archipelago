/**
 * The tree's key, and the size of a channel's shape. The key lists the
 * marks; with a filter, its "show" rows (the map's, Claude Code's, each
 * channel) hide and show those nodes with a click.
 */
import { h } from "preact";
import htm from "htm";
import { v } from "../../spec/style.ts";
import { CHANNELS, shapePath, type Filter } from "./channels.ts";

const html: (s: TemplateStringsArray, ...v: unknown[]) => any = (htm as unknown as { bind(f: typeof h): any }).bind(h);

/**
 * How big a channel's shape is drawn, in the picture's units, for a dot of
 * radius `r` at zoom `k`: this much bigger than a plain dot, up to
 * SHAPE_MOST, short of the name's gap; and never under SHAPE_SCREEN pixels
 * on screen, so circle, diamond, square and triangle read apart however far
 * the tree is zoomed out. A small tree (a preview) draws it at SHAPE_SMALL,
 * or SMALL_SCREEN pixels.
 */
export const SHAPE_GROW = 1.6;
export const SHAPE_MOST = 6;
export const SHAPE_SCREEN = 4;
export const SHAPE_SMALL = 5;
export const SMALL_SCREEN = 2;

export function shapeRadius(r: number, k: number, small: boolean): number {
  const zoom = k > 0 ? k : 1;
  return small ? Math.max(SHAPE_SMALL, SMALL_SCREEN / zoom) : Math.max(Math.min(r * SHAPE_GROW, SHAPE_MOST), SHAPE_SCREEN / zoom);
}

const KeyRow = (mark: unknown, text: string) => html`${mark}<span>${text}</span>`;

/** The key as a filter: what it hides, and a click on a row hides or shows it. */
export interface KeyFilter {
  off: ReadonlySet<string>;
  onToggle(f: Filter): void;
}

/** A row of the key that filters: its mark and words, struck while hidden. */
const FilterRow = (f: Filter, mark: unknown, text: string, filter?: KeyFilter) => {
  if (!filter) return KeyRow(mark, text);
  const off = filter.off.has(f);
  const flip = (e: Event) => {
    e.stopPropagation();
    filter.onToggle(f);
  };
  return html`<button class=${`rx-krow${off ? " off" : ""}`} title=${off ? "Hidden: show it again" : "Hide these from the tree"} onPointerDown=${(e: Event) => e.stopPropagation()} onClick=${flip}>${mark}<span>${text}</span></button>`;
};

/** The marks a filter can hide: who it is from, then each channel. Shared by the open key and the collapsed one. */
const FILTERS = (): { f: Filter; mark: unknown; text: string }[] => [
  { f: "map", mark: html`<svg viewBox="0 0 14 10"><path d="M1 5H8" style=${`stroke:${v("say")};stroke-width:2`} /><circle cx="10" cy="5" r="3" style=${`fill:${v("owner")}`} /></svg>`, text: "the map's: what we supply" },
  { f: "harness", mark: html`<svg viewBox="0 0 14 10"><path d="M1 5H8" style=${`stroke:${v("harness")};stroke-width:2`} /><circle cx="10" cy="5" r="3" style=${`fill:${v("harness")}`} /></svg>`, text: "orange: Claude Code gave it" },
  ...CHANNELS.map((c) => ({ f: c.channel as Filter, mark: html`<svg viewBox="0 0 14 10"><path transform="translate(7 5)" d=${shapePath(c.shape, 3.6)} style=${`fill:${v("dim")}`} /></svg>`, text: `${c.title}: ${c.key}` })),
];

const stop = (e: Event) => e.stopPropagation();

/**
 * The key, never gone: open, every mark with its words; or collapsed to one
 * line of the marks that filter, each still a click to hide or show. Its
 * head opens or collapses it (`onOpen`).
 */
export const Key = ({ hues, filter, open = true, onOpen }: { hues: Map<string, string>; filter?: KeyFilter; open?: boolean; onOpen?(open: boolean): void }) => {
  const head = onOpen && html`<button class="rx-khead" title=${open ? "Collapse the key to one line" : "Open the key"} onPointerDown=${stop} onClick=${(e: Event) => (stop(e), onOpen(!open))}>key ${open ? "▾" : "▸"}</button>`;
  if (!open)
    return html`<div class="rx-key closed filters">
      ${head}
      ${FILTERS().map(({ f, mark, text }) => {
        const off = !!filter?.off.has(f);
        return html`<button class=${`rx-kmark${off ? " off" : ""}`} title=${`${text}${filter ? (off ? "\nHidden: a click shows it" : "\nA click hides it") : ""}`} onPointerDown=${stop} onClick=${(e: Event) => (stop(e), filter?.onToggle(f))}>${mark}</button>`;
      })}
    </div>`;
  return html`
  <div class=${`rx-key${filter || onOpen ? " filters" : ""}`}>
    ${head && html`<span class="rx-kfull">${head}</span>`}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><path class="rx-trail k-say" d="M1 5H13" style="stroke-opacity:1" /></svg>`, "said")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><path class="rx-trail k-fail" d="M1 5H13" style="stroke-opacity:1" /></svg>`, "refused · failed")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="k-write" cx="7" cy="5" r="4" /></svg>`, "acted")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("fg")};opacity:.38`} /></svg>`, "held back")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:${v("fg")};stroke:${v("dim")};stroke-dasharray:1.5 1;stroke-width:1.2`} /></svg>`, "shadow would hold")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-held" cx="7" cy="5" r="3.5" /></svg>`, "held")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-failed" cx="7" cy="5" r="3.5" /></svg>`, "failed")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle class="rx-ring v-quiet" cx="7" cy="5" r="3.5" /></svg>`, "quiet")}
    ${KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3" style=${`fill:none;stroke:${v("fg")};stroke-width:1.2`} /></svg>`, "trial")}
    ${filter && html`<span class="rx-kh">show</span><span class="rx-kh">a click hides or shows</span>`}
    ${FILTERS().map(({ f, mark, text }) => FilterRow(f, mark, text, filter))}
    ${[...hues].map(([p, c]) => KeyRow(html`<svg viewBox="0 0 14 10"><circle cx="7" cy="5" r="3.5" style=${`fill:${c}`} /></svg>`, p === "words" ? "the map's words" : p === "grow" ? "learned" : p))}
  </div>
`;
};
