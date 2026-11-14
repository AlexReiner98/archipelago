// How a picture or a page looks: the presets the packs ship, under the styles the map keeps. Every value the kernel
// draws by comes from here; the kernel keeps none of its own ("Where does style live?", decided 20 Oct 2026).
//
// Layers, the nearest last, each field of a nearer one over the same field of those before it:
//   a preset on nothing (the workspace's), a style kept about nothing, a preset on nothing that says it lies over it,
//   a preset on the item's kind or type, a style kept on it,
//   a style or layout kept about the item, the view's own, one named outright.
// A layout (core's layout type) is code: it draws only about the item or named outright, never as the workspace's, and
// its settings are a layer like a style's fields. A style holds no code: one written before the layout type has it
// left out. A layer that names a shape and has no code, or says code: null, clears the code of those beneath it: a
// style named outright draws as it says, whatever a layout about the project draws.
// A style kept with a preset's id (preset) is the owner's version of that preset: its fields over the preset's, in
// the preset's place; retired, the preset is not used. Read each time, so a change shows on the next look.
// A preset that says it is chosen (over: "chosen", a theme) is used only once the owner keeps a version of it, and
// lies over the presets on nothing. The colours (theme) merge name by name and are finished last (packs/styles/kernel/colours.ts); a
// person's own style, kept about their person item, gives its colours over everything for the pages they see.

import type { KernelContext, RegistryRead } from '#pelago/kernel';
import { finishTheme, mergeTheme } from './colours.ts';
import { cssProblem } from './page-css.ts';

/** Whether a layout's code is there to run: one text, or files by path entered at index.js. */
const coded = (v: unknown) => (typeof v === 'string' && v.trim() !== '') || (!!v && typeof v === 'object' && typeof (v as Record<string, unknown>)['index.js'] === 'string');

/** A preset a pack ships (packs/loader/kernel/declared.ts, StyleDef). */
export interface StyleDef {
  id: string;
  type?: string;
  title: string;
  body?: string;
  on?: string[];
  over?: 'workspace' | 'chosen';
  props: Record<string, unknown>;
}

/** A style, layout or view kept on the map, with what it is about (packs/lenses/kernel/query-kept.ts, Kept). */
export interface Kept {
  id: string;
  type?: string;
  title: string;
  props: Record<string, unknown>;
  about: string[];
}

/** The style presets the packs ship, each with its pack, in the order the packs load (packs/loader/kernel/declared.ts, stylesOf). */
const stylesOf = (packs: readonly { id: string; styles?: StyleDef[] }[]): Preset[] =>
  packs.flatMap((pack) => (pack.styles ?? []).filter((s) => (s.type ?? 'style') === 'style').map((s) => ({ ...s, pack: pack.id })));

// What a style is on, as a link's end names it (packs/loader/kernel/link-ends.ts): a type, has:<capability>, or has:deliverable.
const HAS = 'has:';
const DELIVERABLE = `${HAS}deliverable`;
const capabilityOf = (end: string) => (end.startsWith(HAS) ? end.slice(HAS.length) : undefined);
type TypeRead = { lineage: string[]; capabilities: object; deliverable?: unknown };
const holds = (allowed: string, type: TypeRead | undefined): boolean => {
  if (allowed === '*') return true;
  if (!type) return false;
  const cap = capabilityOf(allowed);
  return cap ? (type.capabilities as Record<string, unknown>)[cap] !== undefined : type.lineage.includes(allowed);
};

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
  /** What a view holds of how it is drawn (ownStyle): over everything but a style named outright. */
  own?: Record<string, unknown>;
  named?: unknown;
  /** The person the page is drawn for: their own style's colours lie over everything. */
  person?: string;
  /** A chosen preset (a theme) tried on one screen: drawn as if the owner kept it, over every other chosen one, and nothing kept. */
  try?: string;
}

/** The owner's versions of presets, open or retired: retired, the preset is not used. A style's of the packs' style presets, a layout's of their drawings. */
const versionsOf = async (ctx: KernelContext, type: 'style' | 'layout' = 'style') => (await ctx.reads({ versions: type })) as Version[];

/** Every style or layout (of the types given) kept on the map, with what each is about; and one named outright, retired or not (packs/lenses/kernel/query-kept.ts, keptOf). */
const keptOf = async (ctx: KernelContext, type: 'style' | 'layout' | ('style' | 'layout')[], named: unknown) =>
  (await ctx.reads({ looks: { types: [type].flat(), ...(typeof named === 'string' && { named }) } })) as Kept[];

/** What a layout draws with, as a layer: its settings, and its code. */
const layoutLayer = (props: Record<string, unknown>): Record<string, unknown> => ({
  ...(props.settings && typeof props.settings === 'object' && !Array.isArray(props.settings) ? ownStyle(props.settings) : {}),
  ...(coded(props.code) && { code: props.code }),
});

/** What a style draws with, as a layer: never code, which only a layout holds. */
const styleLayer = (props: Record<string, unknown>): Record<string, unknown> => {
  const { code: _code, modules: _modules, writes: _writes, ...rest } = props;
  return rest;
};

const fields = (props: Record<string, unknown>) => Object.fromEntries(Object.entries(props).filter(([key, value]) => value != null && key !== 'preset' && key !== 'on'));
const listed = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);

/** What a view holds of how it is drawn: its layout and settings. A style it names is said apart, and code runs only from a style kept on the map. */
export const ownStyle = (own: unknown): Record<string, unknown> => {
  const { style: _named, canvas: _canvas, code: _code, modules: _modules, writes: _writes, preset: _preset, on: _on, ...settings } = (own ?? {}) as Record<string, unknown>;
  return settings;
};

/** The style a picture or page is drawn in, and what went into it, the nearest last. `kept` is every open style and layout on the map, with what each is about. */
export async function styleFor(ctx: KernelContext, kept: Kept[], ask: StyleAsk, given?: Version[]): Promise<{ style: Record<string, unknown>; used: { id: string; title: string; preset?: string }[]; coder?: string }> {
  const registry: RegistryRead = ctx.registry;
  const presets: Preset[] = stylesOf(registry.packs);
  const versions = given ?? (await versionsOf(ctx));
  // A field that names things (sizes, numbers, colours, a page) is merged name by name: a nearer style that sets one keeps the rest.
  const named = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const over = (base: Record<string, unknown>, top: Record<string, unknown>) => {
    const out = { ...base };
    for (const [key, value] of Object.entries(top)) out[key] = key === 'theme' ? mergeTheme(out[key], value) : named(value) && named(out[key]) ? { ...out[key], ...value } : value;
    return out;
  };
  // A style is on a type and its flavours, or on what a type says of itself: has:<capability>, or has:deliverable for
  // whatever is made for a reader, from any pack (core's reading look: the owner, 10 Nov 2026, e_nvhjsf3r).
  const hubType = ask.hub && registry.type(ask.hub.type);
  const onIt = (on: string[]) => ask.hub !== undefined && on.some((t) => (t === DELIVERABLE ? Boolean(hubType?.deliverable) : capabilityOf(t) ? holds(t, hubType) : registry.isA(ask.hub!.type, t)));
  const layers: { weight: number; id: string; title: string; preset?: string; props: Record<string, unknown> }[] = [];
  for (const p of presets) {
    const mine = versions.find((v) => v.props.preset === p.id);
    const tried = p.over === 'chosen' && p.id === ask.try;
    if (!tried && ((mine && !mine.is_open) || (p.over === 'chosen' && !mine))) continue;
    const on = mine && listed(mine.props.on).length ? listed(mine.props.on) : (p.on ?? []);
    const weight = !on.length ? (p.over === 'workspace' ? 1.5 : tried ? 0.6 : p.over === 'chosen' ? 0.5 : 0) : onIt(on) ? 2 : -1;
    if (weight < 0) continue;
    layers.push({ weight, id: mine?.id ?? p.id, title: mine?.title || p.title, preset: p.id, props: mine ? over(p.props, fields(mine.props)) : p.props });
  }
  for (const one of kept) {
    if (one.props.preset != null) continue;
    // A layout draws only where it is named, or on the pictures of what it is about: never as the workspace's, nor on kinds.
    if (one.type !== undefined && registry.isA(one.type, 'layout')) {
      const weight = one.id === ask.named ? 6 : ask.hub !== undefined && one.about.includes(ask.hub.id) ? 4 : -1;
      if (weight >= 0) layers.push({ weight, id: one.id, title: one.title, props: layoutLayer(one.props) });
      continue;
    }
    const on = listed(one.props.on);
    const weight = one.id === ask.named ? 6 : ask.hub !== undefined && one.about.includes(ask.hub.id) ? 4 : on.length ? (onIt(on) ? 3 : -1) : one.about.length ? -1 : 1;
    if (weight >= 0) layers.push({ weight, id: one.id, title: one.title, props: styleLayer(one.props) });
    if (ask.person !== undefined && one.about.includes(ask.person) && one.props.theme != null) layers.push({ weight: 7, id: one.id, title: one.title, props: { theme: one.props.theme } });
  }
  if (ask.own) layers.push({ weight: 5, id: 'view', title: 'This view', props: ask.own });
  layers.sort((a, b) => a.weight - b.weight);
  let style: Record<string, unknown> = {};
  // The layout whose code draws, when one has code: what a change its drawing asks for names (packs/rules/kernel/layout-changes.ts).
  let coder: string | undefined;
  for (const layer of layers) {
    // A nearer style that names a shape and has no code of its own, or says code: null, is drawn as it says: the code beneath it is cleared.
    if (!coded(layer.props.code) && (layer.props.code === null || typeof layer.props.shape === 'string')) (delete style.code, (coder = undefined));
    style = over(style, fields(layer.props));
    if (coded(layer.props.code) && layer.id !== layer.preset) coder = layer.id;
  }
  if (style.theme != null) style.theme = finishTheme(style.theme);
  return { style, used: layers.map(({ id, title, preset }) => ({ id, title, ...(preset && { preset }) })), ...(coder && { coder }) };
}

/** A picture's style with the drawing it is drawn by, if a pack draws its shape: its modules left out when the page has them (`have`, hashes). */
export async function drawn(ctx: KernelContext, style: Record<string, unknown>, have: unknown): Promise<Record<string, unknown>> {
  // Which drawing, under the owner's version of it, and its modules: read off the packs' folders (packs/loader/kernel/layouts.ts, layoutFor).
  const drawing = (await ctx.reads({ drawing: { style, have: Array.isArray(have) ? have.map(String) : [] } })) as { shape: string } | null;
  return drawing ? { ...style, shape: drawing.shape, drawing } : style;
}

/** The schema with its style presets as the map keeps them: each with the owner's version, when there is one. */
export async function withStyles<T extends { styles: Preset[] }>(ctx: KernelContext, described: T): Promise<Omit<T, 'styles'> & { styles: (Preset & { item?: string; retired?: boolean })[] }> {
  const versions = await versionsOf(ctx);
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
 * map when one is named (`style`), and what a view kept on the map holds when it is drawn (`view`). What the item page, the pages that are not pictures and the canvas read; asked
 * with `have` (the drawings' hashes the page holds), with the drawing it names, as a lens answer's style is.
 */
export async function pageStyle(ctx: KernelContext, input: { of?: unknown; style?: unknown; view?: unknown; have?: unknown; try?: unknown; shape?: unknown }, forPerson = true) {
  const of = typeof input.of === 'string' ? input.of : undefined;
  const named = typeof input.style === 'string' ? input.style : undefined;
  const item = of === undefined ? undefined : ((await ctx.reads({ ids: [of] })) as { id: string; type: string }[]).map(({ id, type }) => ({ id, type }))[0];
  if (of !== undefined && !item) throw new Error(`No item "${of}"`);
  const view = typeof input.view === 'string' ? input.view : undefined;
  // The person it is drawn for: the one signed in, or on a map nobody signs in to, its owner.
  const person = !forPerson ? undefined : ((await ctx.reads({ drawn_for: true })) as string | null) || undefined;
  const tried = typeof input.try === 'string' ? input.try : undefined;
  // A view kept on the map holds its own layout and settings, over every style but one named outright.
  const own = view === undefined ? undefined : ownStyle(((await ctx.reads({ ids: [view] })) as { props?: Record<string, unknown> }[])[0]?.props?.style);
  const read = await styleFor(ctx, await keptOf(ctx, ['style', 'layout'], named), { ...(item && { hub: item }), ...(own && { own }), ...(named && { named }), ...(person && { person }), ...(tried && { try: tried }) });
  // The shape the reader chose for this view (the view band's switch) over that, so its drawing comes with it.
  if (typeof input.shape === 'string' && input.shape) {
    read.style.shape = input.shape;
    delete read.style.code;
    delete read.coder;
  }
  return input.have === undefined ? read : { ...read, style: await drawn(ctx, read.style, input.have) };
}

/** The workspace's icon, what a browser's tab and a client listing this server show: its style's icon, else its emblem, as PNG bytes, or none. */
export async function iconOf(ctx: KernelContext): Promise<Buffer | null> {
  const { icon, emblem } = (await pageStyle(ctx, {}, false)).style;
  const mark = typeof icon === 'string' && icon ? icon : emblem;
  const png = typeof mark === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(mark) : null;
  return png ? Buffer.from(png[1], 'base64') : null;
}

/**
 * What a page read by no login is drawn in: the colours (theme), lengths, typefaces (faces) and text roles (type) of
 * the workspace's style, and of a document, its own style over the workspace's, with the head it gives its page
 * (page.head: an invoice's) and the section whose figure is shown where a link to it is posted (page.share). Never a viewer's own. A published document is drawn in the look kept with
 * it (`look`), or one published before that was kept, as the map stood at the position it was published at (`at`), so its look changes only when a person publishes it again.
 */
export async function pageLook(ctx: KernelContext, doc?: Record<string, unknown>) {
  // One published since its look is kept with it (packs/publish/kernel/published.ts) is drawn in that, whatever the map holds now.
  // One kept before a look held its way to start a map is given the workspace's words for it as they stand.
  if (doc?.look && typeof doc.look === 'object') return 'start' in doc.look ? (doc.look as Look) : { ...(doc.look as Look), ...(await startWords(ctx)) };
  const hub = doc && typeof doc.type === 'string' ? { hub: { id: String(doc.id ?? ''), type: doc.type } } : {};
  const at = typeof doc?.style_at === 'number' ? doc.style_at : undefined;
  const key = at === undefined ? '' : `${ctx.workspace} ${at} ${String(doc?.id)}`;
  if (key && looks.has(key)) return looks.get(key)!;
  const now = async () => ({ kept: await keptOf(ctx, 'style', undefined), versions: undefined as Version[] | undefined });
  // A page outlives its style: one that cannot be made again from the log is drawn in the style as it stands.
  const { kept, versions } = at === undefined ? await now() : await stylesAt(ctx, at).catch((err) => (console.error(`the style of ${String(doc?.id)} at ${at}:`, err), now()));
  const style = (await styleFor(ctx, kept, hub, versions)).style as { theme: unknown; lengths: unknown; faces?: unknown; type?: unknown; page_css?: unknown; page?: { head?: unknown; share?: unknown }; start?: unknown };
  const { theme, lengths, faces, type, page_css, page, start } = style;
  const look: Look = {
    theme, lengths, faces, type,
    ...(typeof page_css === 'string' && page_css.trim() && !cssProblem(page_css, true) && { page_css }),
    ...(typeof page?.head === 'string' && { head: page.head }),
    ...(typeof page?.share === 'string' && SECTION.test(page.share) && { share: page.share }),
    ...(typeof start === 'string' && start.trim() && { start: start.trim() }),
  };
  if (key) {
    looks.set(key, look);
    if (looks.size > LOOKS_KEPT) looks.delete(looks.keys().next().value!);
  }
  return look;
}

/** The words of the way to start a map of one's own, as the workspace's style says them now. */
async function startWords(ctx: KernelContext) {
  const { start } = (await styleFor(ctx, await keptOf(ctx, 'style', undefined), {})).style as { start?: unknown };
  return typeof start === 'string' && start.trim() ? { start: start.trim() } : {};
}

interface Look { theme: unknown; lengths: unknown; faces?: unknown; type?: unknown; page_css?: string; head?: string; share?: string; start?: string }

/** An item's id, as a style names the section whose figure is a page's link picture (page.share). */
const SECTION = /^e_[a-z0-9]{8}$/;

/** Published looks already read, by workspace, position and document: what stood then does not change. */
const looks = new Map<string, Look>();
const LOOKS_KEPT = 256;

/** The styles kept on the map as they stood at a fact position: made again from the log (packs/log/kernel/rebuild.ts, asOf). */
const stylesAt = async (ctx: KernelContext, pos: number) => (await ctx.reads({ styles_at: pos })) as { kept: Kept[]; versions: Version[] };

/** A length as a style may give it: a number of pixels, or numbers with one of these units. */
const LENGTH = /^\d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?( \d+(\.\d+)?(px|ch|em|rem|vh|vw|%)?)*$/;

/** A typeface as a style may give it: font family names, quoted or not, and commas; nothing that ends a rule. */
const FACE = /^[A-Za-z0-9 ,'"-]+$/;
const NAME = /^[a-z][a-z0-9_]*$/;

/** A style's faces and text roles as the variables every stylesheet reads, as packs/kit/page/theme.js sets them (typeVars there). */
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
 * until the workspace's own style is read (packs/kit/page/theme.js paints that over it). Only a plain name and a length, or a
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

/** The page's lengths as a stylesheet, of the packs this map runs (surface.lengths: the server's /layout.css). */
export const lengthsOf = (ctx: KernelContext) => lengthsSheet(ctx.registry.packs as Parameters<typeof stylesOf>[0]);
