// How a picture or a page looks: the presets the packs ship, under the styles the map keeps. Every value the kernel
// draws by comes from here; the kernel keeps none of its own ("Where does style live?", decided 20 Oct 2026).
//
// Layers, the nearest last, each field of a nearer one over the same field of those before it:
//   a preset on nothing (the workspace's), a style kept about nothing,
//   a preset on the item's kind or type, a style kept on it,
//   a style kept about the item, one about the view drawn, one named outright.
// A style kept with a preset's id (preset) is the owner's version of that preset: its fields over the preset's, in
// the preset's place; retired, the preset is not used. Read each time, so a change shows on the next look.

import { stylesOf, type StyleDef } from './declared.ts';
import { keptOf, type Kept } from './lens-kept.ts';
import type { Archipelago } from './pelago.ts';

export interface Preset extends StyleDef {
  pack: string;
}

interface Version {
  id: string;
  title: string;
  is_open: boolean;
  props: Record<string, unknown>;
}

/** What a picture or page is drawn for: the item it is of (and its type), the view drawn, a style named outright. */
export interface StyleAsk {
  hub?: { id: string; type: string };
  view?: string;
  named?: unknown;
}

/** The owner's versions of presets, open or retired: retired, the preset is not used. */
async function versionsOf(l: Archipelago): Promise<Version[]> {
  const { rows } = await l.db.query<Version>(`select id, title, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null and props ->> 'preset' is not null order by updated_at, id`, [l.registry.family('style')]);
  return rows;
}

const fields = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).filter(([key, value]) => value != null && key !== 'preset' && key !== 'on'));
const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** The style a picture or page is drawn in, and what went into it, the nearest last. `kept` is every open style on the map, with what each is about. */
export async function styleFor(l: Archipelago, kept: Kept[], ask: StyleAsk): Promise<{ style: Record<string, unknown>; used: { id: string; title: string; preset?: string }[] }> {
  const presets: Preset[] = stylesOf(l.registry.packs);
  const versions = await versionsOf(l);
  // A field that names things (sizes, numbers, colours, a page) is merged name by name: a nearer style that sets one keeps the rest.
  const named = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const over = (base: Record<string, unknown>, top: Record<string, unknown>) => {
    const out = { ...base };
    for (const [key, value] of Object.entries(top)) out[key] = named(value) && named(out[key]) ? { ...out[key], ...value } : value;
    return out;
  };
  const onIt = (on: string[]) => ask.hub !== undefined && on.some((t) => l.registry.isA(ask.hub!.type, t));
  const layers: { weight: number; id: string; title: string; preset?: string; props: Record<string, unknown> }[] = [];
  for (const p of presets) {
    const mine = versions.find((v) => v.props.preset === p.id);
    if (mine && !mine.is_open) continue;
    const on = mine && listed(mine.props.on).length ? listed(mine.props.on) : (p.on ?? []);
    const weight = !on.length ? 0 : onIt(on) ? 2 : -1;
    if (weight < 0) continue;
    layers.push({ weight, id: mine?.id ?? p.id, title: mine?.title || p.title, preset: p.id, props: mine ? over(p.props, fields(mine.props)) : p.props });
  }
  for (const one of kept) {
    if (one.props.preset != null) continue;
    const on = listed(one.props.on);
    const weight = one.id === ask.named ? 6 : ask.view !== undefined && one.about.includes(ask.view) ? 5 : ask.hub !== undefined && one.about.includes(ask.hub.id) ? 4 : on.length ? (onIt(on) ? 3 : -1) : one.about.length ? -1 : 1;
    if (weight >= 0) layers.push({ weight, id: one.id, title: one.title, props: one.props });
  }
  layers.sort((a, b) => a.weight - b.weight);
  let style: Record<string, unknown> = {};
  for (const layer of layers) style = over(style, fields(layer.props));
  return { style, used: layers.map(({ id, title, preset }) => ({ id, title, ...(preset && { preset }) })) };
}

/** The schema with its style presets as the map keeps them: each with the owner's version, when there is one. */
export async function withStyles<T extends { styles: Preset[] }>(l: Archipelago, described: T): Promise<Omit<T, 'styles'> & { styles: (Preset & { item?: string; retired?: boolean })[] }> {
  const versions = await versionsOf(l);
  return {
    ...described,
    styles: described.styles.map((p) => {
      const mine = versions.find((v) => v.props.preset === p.id);
      return { ...p, ...(mine && { item: mine.id, ...(!mine.is_open && { retired: true }) }) };
    }),
  };
}

/** The style a page is drawn in: of one item (its kind's, then its own), or the workspace's. What the item page and the pages that are not pictures read. */
export async function pageStyle(l: Archipelago, input: { of?: unknown }) {
  const of = typeof input.of === 'string' ? input.of : undefined;
  const item = of === undefined ? undefined : (await l.db.query<{ id: string; type: string }>('select id, type from entity where id = $1', [of])).rows[0];
  if (of !== undefined && !item) throw new Error(`No entity "${of}"`);
  return styleFor(l, await keptOf(l, 'style', undefined), item ? { hub: item } : {});
}

/** What the page itself is drawn in: the colours (theme) and lengths of the workspace's style. Sent with a page read by no login. */
export async function pageLook(l: Archipelago) {
  const { theme, lengths } = (await pageStyle(l, {})).style;
  return { theme, lengths };
}

/** A length as a style may give it: a number of pixels, or numbers with one of these units. */
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;

/**
 * The page's lengths as the presets on nothing give them, as a stylesheet: what the page is laid out by until the
 * workspace's own style is read (ui/theme.js paints that over it). Only a plain name and a length go in.
 */
export function lengthsSheet(packs: Parameters<typeof stylesOf>[0]): string {
  const lengths: Record<string, unknown> = {};
  for (const preset of stylesOf(packs)) if (!preset.on?.length && preset.props.lengths && typeof preset.props.lengths === 'object') Object.assign(lengths, preset.props.lengths);
  const lines = Object.entries(lengths).flatMap(([name, value]) => {
    const length = typeof value === 'number' && value >= 0 ? `${value}px` : typeof value === 'string' && LENGTH.test(value) ? value : null;
    return /^[a-z][a-z0-9_]*$/.test(name) && length ? [`  --${name.replaceAll('_', '-')}: ${length};`] : [];
  });
  return `:root {\n${lines.join('\n')}\n}\n`;
}
