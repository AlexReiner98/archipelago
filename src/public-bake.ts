// A public view baked as a page (task e_4c8u53gw; decision e_btxq2nzq): where its picture is drawn by a pack's rails
// layout, the server runs that layout on the view's frozen answer and hands the reader its scene (the marks, the stops,
// the camera on the whole) and the style's values, for one HTML page a search engine and a reader with no script read
// whole (packs/reader/bake.js writes it). The words are the ones frozen when the view was shared; the code is the
// pack's as this server runs it, never a version on the map: a layout changed on the map is code anyone who may change
// the map wrote, and runs only in a reader's sandbox. So a bake is kept by when the view was shared and the commit the
// server runs, and made again when either moves.

import { cssProblem } from './css-check.ts';
import { startedFrom } from './config.ts';
import { packLayout } from './layouts.ts';
import type { Archipelago } from './pelago.ts';
import { sceneOf } from './published-frames.ts';

/** The shape whose drawing walks a picture by its stops (packs/canvas/layouts/rails). */
export const RAILS = 'rails';

type Lens = { style?: Record<string, unknown>; items?: unknown[]; links?: unknown[] } & Record<string, unknown>;
type Doc = { id?: unknown; published_at?: unknown; lenses?: Record<string, Lens> } & Record<string, unknown>;
type Stop = { id: string; title: string; note: string; x: number; y: number; span: number; zoom: number };
export type Baked = {
  /** The section whose picture is baked. */
  section: string;
  scene: { svg: unknown; css: string; size: { width: number; height: number }; stops: Stop[]; whole: { x: number; y: number; span: number; zoom: number } };
  /** The style's values the page dresses itself in (ui/query-base.js dress): colours, sizes, numbers, its font. */
  style: Record<string, unknown>;
  /** What it is kept by: when the view was shared, and the commit that drew it. */
  key: string;
};

/** The first picture a public view holds whose drawing is a pack's rails, with that drawing's code as this server has it. */
export function railsOf(l: Pick<Archipelago, 'registry'>, doc: Doc | null) {
  for (const [section, lens] of Object.entries(doc?.lenses ?? {})) {
    const style = lens.style ?? {};
    const drawing = style.drawing as { id?: string } | undefined;
    if (style.shape !== RAILS || typeof drawing?.id !== 'string') continue;
    const own = packLayout(l.registry, drawing.id);
    if (own?.entry) return { section, lens, entry: own.entry };
  }
  return null;
}

/** The values of a style a page may be dressed in; nothing else of it goes out. */
const dressOf = (style: Record<string, unknown>) =>
  Object.fromEntries(['colors', 'sizes', 'numbers', 'font', 'text', 'radius', 'gap', 'column', 'faces', 'type'].filter((k) => style[k] !== undefined).map((k) => [k, style[k]]));

const kept = new Map<string, Promise<Baked | null>>();
const KEPT = 64;

/** A public view baked: its rails picture's scene and the style's values; null when it has none, or it cannot be drawn. */
export function bake(l: Pick<Archipelago, 'registry' | 'workspace'>, doc: Doc | null): Promise<Baked | null> {
  const found = railsOf(l, doc);
  if (!found) return Promise.resolve(null);
  const key = `${String(doc?.published_at ?? '')}@${startedFrom() ?? 'here'}`;
  const at = `${l.workspace} ${String(doc?.id)} ${found.section} ${key}`;
  if (!kept.has(at)) {
    kept.set(at, run(l, found, key).catch((err) => (console.error(`baking ${String(doc?.id)}:`, (err as Error).message), null)));
    if (kept.size > KEPT) kept.delete(kept.keys().next().value!);
  }
  return kept.get(at)!;
}

async function run(l: Pick<Archipelago, 'registry'>, { section, lens, entry }: NonNullable<ReturnType<typeof railsOf>>, key: string): Promise<Baked | null> {
  const { first: _first, ...frozen } = lens;
  const scene = (await sceneOf(l, frozen, entry)) as Baked['scene'] | null;
  if (!scene || !Array.isArray(scene.stops) || !scene.whole) return null;
  // A stylesheet the drawing sent is held to what a drawing's may say, as the page holds it (ui/marks.js cssFor).
  const css = typeof scene.css === 'string' && !cssProblem(scene.css) ? scene.css : '';
  return { section, scene: { svg: scene.svg, css, size: scene.size, stops: scene.stops, whole: scene.whole }, style: dressOf(lens.style ?? {}), key };
}
