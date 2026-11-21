/**
 * style: the tokens every view draws with. See style.md.
 *
 * A token is a CSS custom property on the page's root (`--fg`). A style
 * pack sets them, in light and dark; a view only ever refers to them. With
 * no style loaded, each token is its plain value here: the system's own
 * colours and font, so the page still reads.
 */
import type { Json, Term } from "./common.ts";
import type { TypeInfo } from "./types.ts";

/** Where an item's status sits: the first open, a later open, the first closed, a later closed. */
export type Side = "fresh" | "moving" | "done" | "gone";
export const SIDES: readonly Side[] = ["fresh", "moving", "done", "gone"];

/** A base's mark shape, by the base's place among the bases defined. */
export type Shape = "square" | "diamond" | "circle" | "triangle";
export const SHAPES: readonly Shape[] = ["square", "diamond", "circle", "triangle"];

/** A verdict on a node in a run, and `none` for not said. */
export type Verdict = "held" | "failed" | "quiet" | "none";
export const VERDICTS: readonly Verdict[] = ["held", "failed", "quiet", "none"];

/** Where a status sits among its type's statuses. */
export function side(t: TypeInfo | undefined, status: Json | undefined): Side {
  if (!t || typeof status !== "string") return "fresh";
  const o = t.statuses.open.indexOf(status);
  if (o === 0) return "fresh";
  if (o > 0) return "moving";
  return t.statuses.closed.indexOf(status) <= 0 ? "done" : "gone";
}

/** A base's shape: its place among the bases (`bases`, their names in order), round again past the last. */
export function shape(bases: readonly string[], t: TypeInfo | undefined): Shape {
  return SHAPES[Math.max(0, bases.indexOf(t?.base ?? "")) % SHAPES.length]!;
}

/** The glyph token for a shape at a side, or for a verdict. */
export type GlyphToken = `glyph-${Shape}-${Side}` | `glyph-${Verdict}`;
export const glyph = (shape: Shape, side: Side): GlyphToken => `glyph-${shape}-${side}`;
export const verdictGlyph = (v: Verdict): GlyphToken => `glyph-${v}`;

const plainGlyphs = {} as Record<GlyphToken, string>;
for (const s of SHAPES) for (const [i, side] of SIDES.entries()) plainGlyphs[glyph(s, side)] = `"${["-", "~", "+", "x"][i]}"`;
Object.assign(plainGlyphs, { "glyph-held": '"+"', "glyph-failed": '"x"', "glyph-quiet": '"o"', "glyph-none": '"."' });

/**
 * Every token and its plain value: what it is with no style loaded. Names
 * are fixed by the edition; a style may set any of them, and a view may
 * read only these.
 */
export const TOKENS = {
  // The page.
  bg: "Canvas",
  fg: "CanvasText",
  dim: "GrayText",
  line: "GrayText",
  panel: "Canvas",
  /** Something linked to what is looked at. */
  lit: "Mark",
  /** What is picked or hovered, and links. */
  pick: "LinkText",
  // Verdicts.
  held: "CanvasText",
  failed: "CanvasText",
  quiet: "GrayText",
  // Items' marks, by side.
  "mark-fresh": "GrayText",
  "mark-moving": "LinkText",
  "mark-done": "CanvasText",
  "mark-gone": "GrayText",
  // What passes on the exchange.
  say: "LinkText",
  write: "CanvasText",
  fire: "CanvasText",
  // Where a node's words come from.
  owner: "CanvasText",
  learned: "CanvasText",
  schema: "GrayText",
  // Packs, in turn.
  "hue-1": "CanvasText",
  "hue-2": "CanvasText",
  "hue-3": "CanvasText",
  "hue-4": "CanvasText",
  "hue-5": "CanvasText",
  "hue-6": "CanvasText",
  // Controls.
  control: "ButtonFace",
  "control-fg": "ButtonText",
  "control-line": "ButtonBorder",
  // Type.
  font: "system-ui, sans-serif",
  mono: "ui-monospace, monospace",
  "text-xs": "10px",
  "text-s": "11px",
  "text-m": "12px",
  text: "13px",
  "text-l": "15px",
  leading: "1.45",
  bold: "600",
  // Space.
  "space-1": "2px",
  "space-2": "4px",
  "space-3": "6px",
  "space-4": "10px",
  "space-5": "16px",
  radius: "3px",
  // The frame's regions (edition 7).
  "frame-left": "260px",
  "frame-right": "360px",
  // Marks.
  ...plainGlyphs,
} as const satisfies Record<string, string>;

export type Token = keyof typeof TOKENS;
export const HUES = ["hue-1", "hue-2", "hue-3", "hue-4", "hue-5", "hue-6"] as const satisfies readonly Token[];

/** A token as a CSS value, its plain value as the fallback: `var(--fg, CanvasText)`. */
export const v = (name: Token) => `var(--${name}, ${TOKENS[name]})`;

/** A view's style sheet with every token it refers to given its plain fallback. */
export function sheet(css: string): string {
  return css.replace(/var\(--([a-z0-9-]+)\)/g, (all, name: string) => (name in TOKENS ? v(name as Token) : all));
}

/** The event a style pack fires on `document` when its tokens come or go. */
export const CHANGED = "style:changed";

/** Calls `on` whenever the tokens change; returns its disposer. A view re-reads then. */
export function onStyle(on: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  document.addEventListener(CHANGED, on);
  return () => document.removeEventListener(CHANGED, on);
}

/**
 * A token's value now, for a view that draws without CSS (a canvas, a
 * glyph in SVG text): the style's, else the plain one. Strings lose their
 * quotes.
 */
export function read(name: Token, el?: Element): string {
  let got = "";
  if (typeof document !== "undefined") got = getComputedStyle(el ?? document.documentElement).getPropertyValue(`--${name}`).trim();
  const value = got || TOKENS[name];
  return /^".*"$/.test(value) ? value.slice(1, -1) : value;
}

/** The token vocabulary, edition 6; the frame's widths, edition 7. */
export const terms: Term[] = [{ term: "style", doc: "Tokens as CSS custom properties on the page's root: colours, type, space and marks.", since: 6 }];
