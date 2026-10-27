// How a picture or a page looks: the presets the packs ship, under the styles the map keeps. Every value the kernel
// draws by comes from here; the kernel keeps none of its own ("Where does style live?", decided 20 Oct 2026).
//
// Layers, the nearest last, each field of a nearer one over the same field of those before it:
//   a preset on nothing (the workspace's), a style kept about nothing, a preset on nothing that says it lies over it,
//   a preset on the item's kind or type, a style kept on it,
//   a style kept about the item, one about the view drawn, one named outright.
// A style kept with a preset's id (preset) is the owner's version of that preset: its fields over the preset's, in
// the preset's place; retired, the preset is not used. Read each time, so a change shows on the next look.
// A preset that says it is chosen (over: "chosen", a theme) is used only once the owner keeps a version of it, and
// lies over the presets on nothing. The colours (theme) merge name by name and are finished last (src/colours.ts); a
// person's own style, kept about their person item, gives its colours over everything for the pages they see.

import { stylesOf, type StyleDef } from './declared.ts';
import { finishTheme, mergeTheme } from './colours.ts';
import { drawingFor } from './drawings.ts';
import { keptOf, type Kept } from './lens-kept.ts';
import { asOf } from './rebuild.ts';
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
  /** The person the page is drawn for: their own style's colours lie over everything. */
  person?: string;
}

/** The owner's versions of presets, open or retired: retired, the preset is not used. */
async function versionsOf(l: Archipelago): Promise<Version[]> {
  const { rows } = await l.db.query<Version>(`select id, title, is_open, ${l.props} from entity where type = any($1::text[]) and archived_at is null and props ->> 'preset' is not null order by updated_at, id`, [l.registry.family('style')]);
  return rows;
}

const fields = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).filter(([key, value]) => value != null && key !== 'preset' && key !== 'on'));
const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** The style a picture or page is drawn in, and what went into it, the nearest last. `kept` is every open style on the map, with what each is about. */
export async function styleFor(l: Archipelago, kept: Kept[], ask: StyleAsk, given?: Version[]): Promise<{ style: Record<string, unknown>; used: { id: string; title: string; preset?: string }[] }> {
  const presets: Preset[] = stylesOf(l.registry.packs);
  const versions = given ?? (await versionsOf(l));
  // A field that names things (sizes, numbers, colours, a page) is merged name by name: a nearer style that sets one keeps the rest.
  const named = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const over = (base: Record<string, unknown>, top: Record<string, unknown>) => {
    const out = { ...base };
    for (const [key, value] of Object.entries(top)) out[key] = key === 'theme' ? mergeTheme(out[key], value) : named(value) && named(out[key]) ? { ...out[key], ...value } : value;
    return out;
  };
  const onIt = (on: string[]) => ask.hub !== undefined && on.some((t) => l.registry.isA(ask.hub!.type, t));
  const layers: { weight: number; id: string; title: string; preset?: string; props: Record<string, unknown> }[] = [];
  for (const p of presets) {
    const mine = versions.find((v) => v.props.preset === p.id);
    if ((mine && !mine.is_open) || (p.over === 'chosen' && !mine)) continue;
    const on = mine && listed(mine.props.on).length ? listed(mine.props.on) : (p.on ?? []);
    const weight = !on.length ? (p.over === 'workspace' ? 1.5 : p.over === 'chosen' ? 0.5 : 0) : onIt(on) ? 2 : -1;
    if (weight < 0) continue;
    layers.push({ weight, id: mine?.id ?? p.id, title: mine?.title || p.title, preset: p.id, props: mine ? over(p.props, fields(mine.props)) : p.props });
  }
  for (const one of kept) {
    if (one.props.preset != null) continue;
    const on = listed(one.props.on);
    const weight = one.id === ask.named ? 6 : ask.view !== undefined && one.about.includes(ask.view) ? 5 : ask.hub !== undefined && one.about.includes(ask.hub.id) ? 4 : on.length ? (onIt(on) ? 3 : -1) : one.about.length ? -1 : 1;
    if (weight >= 0) layers.push({ weight, id: one.id, title: one.title, props: one.props });
    if (ask.person !== undefined && one.about.includes(ask.person) && one.props.theme != null) layers.push({ weight: 7, id: one.id, title: one.title, props: { theme: one.props.theme } });
  }
  layers.sort((a, b) => a.weight - b.weight);
  let style: Record<string, unknown> = {};
  for (const layer of layers) style = over(style, fields(layer.props));
  if (style.theme != null) style.theme = finishTheme(style.theme);
  return { style, used: layers.map(({ id, title, preset }) => ({ id, title, ...(preset && { preset }) })) };
}

/** A picture's style with the drawing it is drawn by, if a pack draws its shape: its modules left out when the page has them (`have`, hashes). */
export async function drawn(l: Archipelago, style: Record<string, unknown>, have: unknown): Promise<Record<string, unknown>> {
  const drawing = drawingFor(l.registry, style, await versionsOf(l), Array.isArray(have) ? have.map(String) : []);
  return drawing ? { ...style, drawing } : style;
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

/**
 * The style a page is drawn in: of one item (its kind's, then its own), or the workspace's, under a style kept on the
 * map when one is named (`style`), and a style kept about a view kept on the map when it is drawn (`view`). What the item page, the pages that are not pictures and the canvas read; asked
 * with `have` (the drawings' hashes the page holds), with the drawing it names, as a lens answer's style is.
 */
export async function pageStyle(l: Archipelago, input: { of?: unknown; style?: unknown; view?: unknown; have?: unknown }, forPerson = true) {
  const of = typeof input.of === 'string' ? input.of : undefined;
  const named = typeof input.style === 'string' ? input.style : undefined;
  const item = of === undefined ? undefined : (await l.db.query<{ id: string; type: string }>('select id, type from entity where id = $1', [of])).rows[0];
  if (of !== undefined && !item) throw new Error(`No item "${of}"`);
  const view = typeof input.view === 'string' ? input.view : undefined;
  // The person it is drawn for: the one signed in, or on a map nobody signs in to, its owner.
  const person = !forPerson ? undefined : l.viewer === undefined ? await l.setting<string>('me') : l.viewer || undefined;
  const read = await styleFor(l, await keptOf(l, 'style', named), { ...(item && { hub: item }), ...(view && { view }), ...(named && { named }), ...(person && { person }) });
  // A view kept on the map draws in the shape it keeps, and lights what it says, over every style.
  const own = view === undefined ? undefined : ((await l.entity(view))?.props.style as Record<string, unknown> | undefined);
  for (const key of ['shape', 'lit']) if (typeof own?.[key] === 'string') read.style[key] = own[key];
  return input.have === undefined ? read : { ...read, style: await drawn(l, read.style, input.have) };
}

/**
 * What a page read by no login is drawn in: the colours (theme), lengths, typefaces (faces) and text roles (type) of
 * the workspace's style, and of a document, its own style over the workspace's, with the head it gives its page
 * (page.head: an invoice's). Never a viewer's own. A published document is drawn as the map stood at the position
 * it was published at (`at`, kept with it), so its colours change only when a person publishes it again.
 */
export async function pageLook(l: Archipelago, doc?: Record<string, unknown>) {
  const hub = doc && typeof doc.type === 'string' ? { hub: { id: String(doc.id ?? ''), type: doc.type } } : {};
  const at = typeof doc?.style_at === 'number' ? doc.style_at : undefined;
  const key = at === undefined ? '' : `${l.workspace} ${at} ${String(doc?.id)}`;
  if (key && looks.has(key)) return looks.get(key)!;
  const { kept, versions } = at === undefined ? { kept: await keptOf(l, 'style', undefined), versions: undefined } : await stylesAt(l, at);
  const style = (await styleFor(l, kept, hub, versions)).style as { theme: unknown; lengths: unknown; faces?: unknown; type?: unknown; page_css?: unknown; page?: { head?: unknown } };
  const { theme, lengths, faces, type, page_css, page } = style;
  const look = { theme, lengths, faces, type, ...(typeof page_css === 'string' && page_css.trim() && { page_css }), ...(typeof page?.head === 'string' && { head: page.head }) };
  if (key) {
    looks.set(key, look);
    if (looks.size > LOOKS_KEPT) looks.delete(looks.keys().next().value!);
  }
  return look;
}

/** Published looks already read, by workspace, position and document: what stood then does not change. */
const looks = new Map<string, Record<string, unknown>>();
const LOOKS_KEPT = 256;

/** The styles kept on the map as they stood at a fact position: made again from the log (src/rebuild.ts, asOf). */
async function stylesAt(l: Archipelago, pos: number): Promise<{ kept: Kept[]; versions: Version[] }> {
  const { rows } = await asOf(l.db, l.registry, l.workspace, pos);
  const family = new Set(l.registry.family('style'));
  const styles = rows.entity.filter((e) => family.has(String(e.type)) && e.archived_at == null) as unknown as (Version & { updated_at: string })[];
  const order = (a: { updated_at: string; id: string }, b: { updated_at: string; id: string }) => String(a.updated_at).localeCompare(String(b.updated_at)) || a.id.localeCompare(b.id);
  styles.sort(order);
  const about = rows.relation.filter((r) => r.type === 'about' && r.valid_to == null);
  return {
    versions: styles.filter((s) => s.props?.preset != null),
    kept: styles.filter((s) => s.is_open).map((s) => ({ id: s.id, title: s.title, props: s.props ?? {}, about: about.filter((r) => r.from_id === s.id).map((r) => String(r.to_id)) })),
  };
}

/** A length as a style may give it: a number of pixels, or numbers with one of these units. */
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;

/** A typeface as a style may give it: font family names, quoted or not, and commas; nothing that ends a rule. */
const FACE = /^[A-Za-z0-9 ,'"-]+$/;
const NAME = /^[a-z][a-z0-9_]*$/;

/** A style's faces and text roles as the variables every stylesheet reads, as ui/theme.js sets them (typeVars there). */
function typeVars(type: unknown, faces: unknown): [string, string][] {
  const out: [string, string][] = [], fs = (faces && typeof faces === 'object' ? faces : {}) as Record<string, unknown>;
  const face = (name: unknown) => (NAME.test(String(name)) && typeof fs[String(name)] === 'string' && FACE.test(fs[String(name)] as string) ? `var(--face-${String(name).replaceAll('_', '-')})` : 'var(--face-text)');
  for (const [name, value] of Object.entries(fs)) if (NAME.test(name) && typeof value === 'string' && FACE.test(value)) out.push([`--face-${name.replaceAll('_', '-')}`, value]);
  for (const [role, t] of Object.entries((type && typeof type === 'object' ? type : {}) as Record<string, any>)) {
    if (!NAME.test(role) || !t || typeof t !== 'object') continue;
    const at = `--type-${role.replaceAll('_', '-')}`;
    out.push([`${at}-family`, face(t.face)], [`${at}-weight`, [400, 600].includes(t.weight) ? String(t.weight) : '400'], [`${at}-style`, t.style === 'italic' ? 'italic' : 'normal']);
    out.push([`${at}-case`, t.case === 'upper' ? 'uppercase' : 'none'], [`${at}-track`, typeof t.track === 'string' && /^-?\d+(\.\d+)?em$/.test(t.track) ? t.track : '0']);
  }
  return out;
}

/**
 * The page's lengths, typefaces and text roles as the presets on nothing give them, as a stylesheet: what the page is laid out by
 * until the workspace's own style is read (ui/theme.js paints that over it). Only a plain name and a length, or a
 * plain list of families, go in.
 */
export function lengthsSheet(packs: Parameters<typeof stylesOf>[0]): string {
  const lengths: Record<string, unknown> = {}, faces: Record<string, unknown> = {}, type: Record<string, unknown> = {};
  for (const preset of stylesOf(packs)) {
    if (preset.on?.length) continue;
    if (preset.props.lengths && typeof preset.props.lengths === 'object') Object.assign(lengths, preset.props.lengths);
    if (preset.props.faces && typeof preset.props.faces === 'object') Object.assign(faces, preset.props.faces);
    if (preset.props.type && typeof preset.props.type === 'object') Object.assign(type, preset.props.type);
  }
  const lines = Object.entries(lengths).flatMap(([name, value]) => {
    const length = typeof value === 'number' && value >= 0 ? `${value}px` : typeof value === 'string' && LENGTH.test(value) ? value : null;
    return /^[a-z][a-z0-9_]*$/.test(name) && length ? [`  --${name.replaceAll('_', '-')}: ${length};`] : [];
  });
  for (const [name, value] of typeVars(type, faces)) lines.push(`  ${name}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}\n`;
}
