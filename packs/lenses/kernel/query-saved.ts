// A view kept on the map (an item of core's lens type, called a canvas on the page): a flat lens and a style, about
// an item or about nothing. Its picture is the flat lens's answer (the query pack's answer.flat) with the style it is
// drawn in (the styles pack's answer.view_style); a document draws it where a line names it, publishing freezes it, and `get`
// says which of them an item is in. Read through the lenses pack's context (docs/kernel-packs.md, "Moving a service
// in the wave"): every read as the asker under row-level security.
//
// Views kept before the flat lens said what was in them with other fields (from, kinds, by, over, far, fold...). They
// are translated once, when a workspace opens (planQueries): what a flat lens can say is kept, what it cannot is said
// in the log and taken off; one with nothing a filter can include is retired.

import type { KernelContext } from '#pelago/kernel';
import { keptOf } from './query-kept.ts';
import { drawnWith, fromBefore, LENS_LIMIT, stepIds, stepsPhased, stepsWrong, type Step } from './lens-words.ts';
import type { Fact } from './view-life.ts';

const ITEM = /^e_[a-z0-9]{8}$/;
/** The type a view is kept as. */
const KEPT = 'lens';

type Props = Record<string, unknown>;
/** What reads only the types: a pack's context, or anything with the registry (the map, until the gather step). */
type Typed = Pick<KernelContext, 'registry'>;
type Row = { id: string; type: string; title: string; props?: Props; is_open?: boolean; archived_at?: unknown; updated_at?: string | Date };
type Link = { from_id: string; to_id: string };
/** An item of the flat lens's answer: its head, the fields its type shows, and why it is there (packs/query/kernel/query-flat.ts). */
export type FlatItem = { id: string; type: string; kind?: string; title: string; body?: string; visibility?: string; status?: string; open?: boolean; owner?: string | null; props?: Props; [field: string]: unknown };
/** A link of the flat lens's answer. */
export type FlatLink = { id: string; type: string; is?: string[]; from: string; to: string; props?: Props };
/** The flat lens's answer, as the query pack gives it (answer.flat). */
export type Flat = { items: FlatItem[]; links: FlatLink[]; lens: Props; [field: string]: unknown };

const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : []);

/** The flat lens answered as the asker: the query pack's. */
const flat = (ctx: KernelContext, lens: Props) => ctx.call<Props, Flat>('answer.flat', lens);

/** The flat lens a kept view draws: its filter with what its steps name, its walk, its limit and its window of time. */
export function viewQuery(props: Props) {
  const filter = { ...((props.filter ?? {}) as Props) };
  const ids = stepIds(props.steps).map((id) => `id ${id}`);
  if (ids.length) filter.find = [...new Set([...list(filter.find), ...ids])];
  return { filter, walk: props.walk ?? { over: [], steps: 0 }, ...(typeof props.limit === 'number' && { limit: props.limit }), ...(props.time != null && { time: props.time }) };
}

/** Whether an item's type is a kept view. */
export const isKept = (ctx: Typed, type: string) => ctx.registry.isA(type, KEPT);
/** The types that bring a kept view in where a line names it. */
export const bringersIn = (ctx: Typed) => drawnWith(ctx.registry, 'document');

/**
 * The picture of a kept view: the flat lens's answer, and the style it is drawn in (the presets, the workspace's, its
 * own layout and settings, the style it names), with the drawing that style names;
 * and its steps, with what they name sent even where the filter leaves it out (a part that is gone is told of).
 */
export async function keptPicture(ctx: KernelContext, id: string, have?: unknown) {
  const [item] = (await ctx.reads({ ids: [id] })) as Row[];
  if (!item || !isKept(ctx, item.type)) throw new Error(`"${id}" is not a view kept on the map`);
  const props = item.props ?? {};
  const { style } = await ctx.call<Props, { style: Props }>('answer.view_style', { own: props.style ?? {}, have: have ?? [] });
  const lens = viewQuery(props);
  let answer = await flat(ctx, lens);
  // Steps that no longer pass are not played, and what is wrong is said beside the picture: a read never refuses.
  const wrong = props.steps === undefined ? undefined : stepsWrong(props.steps);
  const steps = props.steps === undefined || wrong ? undefined : (props.steps as Step[]);
  const told = stepIds(props.steps).filter((id) => !answer.items.some((i) => i.id === id));
  // What a step names that was left out: read again with it, leaving nothing out but what was not sent, so the links among them all come too.
  if (told.length) answer = { ...(await flat(ctx, { filter: { find: [...answer.items.map((i) => i.id), ...told].map((id) => `id ${id}`), not: [] }, limit: Math.min(answer.items.length + told.length, LENS_LIMIT) })), lens: answer.lens };
  // It starts from what it is about, where it draws that; else from the one item it names (as the lens's from was).
  const about = (await ctx.reads({ links: { from: [id], types: ['about'], order: 'id' } })) as Link[];
  const ids = list((lens.filter as Props).ids);
  // Or what it draws what is in: the items it finds in or is narrowed within, and the ends of its link terms.
  const ends = [...list((lens.filter as Props).find), ...list((lens.filter as Props).only)].filter((t) => !/^(id|text|type|kind) /.test(t)).map((t) => t.split(/\s+/).slice(1).join(' '));
  const from = about.map((r) => r.to_id).find((x) => ids.includes(x) || ends.includes(x)) ?? (ids.length === 1 ? ids[0] : undefined);
  // A status a step gives is sent with its phase, by the type of what it is given to.
  const typeOf = new Map(answer.items.map((i) => [i.id, i.type]));
  const phased = steps && stepsPhased(steps, (at, status) => ctx.registry.type(typeOf.get(at) ?? '')?.statuses.phases?.[status]);
  return { ...answer, lens: { ...answer.lens, ...(from && { from }) }, ...(phased && { steps: phased }), ...(wrong && { steps_wrong: wrong }), style };
}

/**
 * The views an item is drawn in: each view kept about something it sits in (its trail) whose lens reaches it, with
 * the documents that bring the view in. The way back from an item to the picture it was reached from.
 */
export async function shownIn(ctx: KernelContext, id: string, trail: { id: string; title: string; views: { id: string; title: string }[] }[]) {
  type Shown = { id: string; title: string; of: { id: string; title: string }; documents: { id: string; type: string; title: string }[]; steps_wrong?: string };
  const bringers = bringersIn(ctx);
  // Each view asked at once, kept in the trail's order: one after another, a get waited for every view's query in turn.
  const asked = trail.flatMap((step) => step.views.map(async (view): Promise<Shown | undefined> => {
    const [item] = (await ctx.reads({ ids: [view.id] })) as Row[];
    const answer = item && (await Promise.resolve(item.props ?? {}).then((props) => flat(ctx, viewQuery(props))).catch(() => undefined));
    if (!item || !answer?.items.some((one) => one.id === id)) return undefined;
    const named = (await ctx.reads({ mentioned: { to: [view.id], types: bringers, order: 'newest', limit: 30 } })) as { id: string; type: string; title: string }[];
    const documents = named.map((m) => ({ id: m.id, type: m.type, title: m.title }));
    const wrong = item.props?.steps === undefined ? undefined : stepsWrong(item.props.steps);
    return { id: view.id, title: view.title, of: { id: step.id, title: step.title }, documents, ...(wrong && { steps_wrong: wrong }) };
  }));
  return (await Promise.all(asked)).filter((s): s is Shown => Boolean(s));
}

// ---- Views kept before the flat lens ------------------------------------------------------------------------------

/** The fields a view kept before the flat lens said what was in it with. Not time: a flat lens keeps its window of
 * time in the same field, in the same words, so a time view kept now is no old view (it was moved, and lost its query,
 * on every start). */
export const OLD_FIELDS = ['from', 'controls', 'kinds', 'by', 'over', 'far', 'near', 'lanes', 'order', 'measure', 'fold'];
/** Each old field the flat lens has no word for, and why. */
const UNSAID: Record<string, string> = {
  controls: 'what the person may change on the page',
  lanes: 'lanes',
  order: 'an ordering field',
  measure: 'what size counts',
  near: 'near',
};

/**
 * A view kept before the flat lens, as a flat lens: it starts from what it names (from) or is about, and from what
 * is part of that (its by), walks the links it sent along one step; of the whole map, it takes the types it kept.
 * The types it kept of what is in an item narrow it: those types within that item (every step down) or only those
 * types of what is part of it (a step), drawn in it as the frame, and not walked (the walk is not narrowed).
 * What is left out stays left out. `lost` says each thing it said that the flat lens cannot: a depth other than one
 * step or every step (the flat walk goes either way, so walking part_of further would climb to what holds it), what
 * the links of a narrowed view reached, unlinked, lanes, controls...
 * Null when nothing in it says what a filter includes.
 */
export function oldQuery(ctx: Typed, props: Props, about: string[]): { lens: { filter: Props; walk: { over: string[] | 'all'; steps: number } } | null; lost: string[] } {
  const lost: string[] = [];
  const known = (t: string) => ctx.registry.types.has(t);
  const linked = (r: string) => ctx.registry.relations.has(r);
  const start = typeof props.from === 'string' && ITEM.test(props.from) ? [props.from] : about;
  if (typeof props.from === 'string' && !ITEM.test(props.from)) lost.push('from "'.concat(props.from, '"'));
  const kinds = list(props.kinds);
  const wanted = kinds.filter((k) => !k.startsWith('-'));
  if (wanted.some((k) => !known(k))) lost.push(`kinds ${wanted.filter((k) => !known(k)).join(', ')}`);
  const types = wanted.filter(known);
  // The types it kept of what is in an item narrow what is in it (only, or within): its walk went only to more of those,
  // and a walk is not narrowed, so it is not kept.
  const narrowed = start.length > 0 && types.length > 0 && props.far !== 0;
  if (start.length && types.length && props.far === 0) lost.push(`kinds kept of the start alone (${types.join(', ')})`);
  // Left out: what it folded (closed and system unless it said), and the types it named with a "-".
  const fold = props.fold === undefined ? ['closed', 'system'] : list(props.fold);
  if (fold.includes('unlinked')) lost.push('leaving out what is linked to nothing');
  const exclude = [...new Set([...fold.filter((f) => f === 'closed' || f === 'system'), ...kinds.filter((k) => k.startsWith('-') && known(k.slice(1))).map((k) => k.slice(1))])];
  const by = typeof props.by === 'string' && linked(props.by) ? props.by : 'part_of';
  const over = props.over === 'all' ? 'all' : (props.over === undefined ? ['depends_on', 'waits_on'] : list(props.over)).filter(linked);
  // Every step down is what is within it, read from the closure of part_of; any other depth, or another link, one step.
  const within = narrowed && props.far === undefined && start.length === 1 && ctx.registry.relationFamily('part_of').includes(by);
  if (start.length && !within && (props.far === undefined || Number(props.far) > 1)) lost.push(`${props.far === undefined ? 'every step' : `${props.far} steps`} down (one is kept)`);
  if (narrowed && (over === 'all' || over.length)) lost.push(`what its links reach of the types it kept (${types.join(', ')})`);
  for (const [field, said] of Object.entries(UNSAID)) if (props[field] != null && !(Array.isArray(props[field]) && !(props[field] as unknown[]).length)) lost.push(said);
  if (!start.length && !types.length) return { lens: null, lost: ['nothing a filter can include: the whole map, of no types', ...lost] };
  // What is part of where it starts is found by a link term, not walked: walking part_of either way would climb.
  // Narrowed, the start is the frame it is drawn in (what the view is about), not one of what is drawn.
  if (narrowed) {
    const filter = within ? { types, within: start, exclude } : { links: start.map((id) => `${by} ${id}`), only: types, exclude };
    return { lens: { filter, walk: { over: [], steps: 0 } }, lost };
  }
  const down = start.length && props.far !== 0 ? start.map((id) => `${by} ${id}`) : [];
  const filter = { ...(start.length && { ids: start }), ...(down.length && { links: down }), ...(!start.length && types.length && { types }), exclude };
  return { lens: { filter, walk: { over, steps: over === 'all' || over.length ? 1 : 0 } }, lost };
}

/** What the move of old views says in the log, on its facts and as something done. */
export const QUERIES_MOVED = 'Views kept before the flat lens are flat lenses now: what each said that a flat lens cannot is in this event';

/**
 * A migration, planned: each view kept before the flat lens is given the flat lens its fields say (oldQuery) and its
 * old fields are taken off, with what did not translate said (lost); one with nothing to include is retired. A style
 * kept about it stays the style it is drawn in. The facts, and what moved and what was lost; the kernel appends them
 * with the event that says what was lost (packs/lenses/kernel/query-saved.ts), which a pack's move does not carry.
 */
export async function planQueries(ctx: KernelContext): Promise<{ facts: Fact[]; moved: number; retired: string[]; lost: Record<string, string[]> }> {
  const rows = (await ctx.reads({ marked: { types: ctx.registry.family(KEPT), keys: OLD_FIELDS } })) as Row[];
  const out = { facts: [] as Fact[], moved: 0, retired: [] as string[], lost: {} as Record<string, string[]> };
  if (!rows.length) return out;
  const ids = rows.map((r) => r.id);
  const about = (await ctx.reads({ links: { from: ids, types: ['about'], order: 'id' } })) as Link[];
  // The styles kept about each, open and not archived, the newest change first.
  const tied = (await ctx.reads({ links: { to: ids, types: ['about'] } })) as Link[];
  const family = new Set(ctx.registry.family('style'));
  const kept = tied.length ? ((await ctx.reads({ ids: [...new Set(tied.map((t) => t.from_id))] })) as Row[]).filter((s) => family.has(s.type) && s.is_open && s.archived_at == null) : [];
  const at = new Map(kept.map((s) => [s.id, new Date(s.updated_at ?? 0).getTime()]));
  const styles = tied.filter((t) => at.has(t.from_id)).sort((a, b) => at.get(b.from_id)! - at.get(a.from_id)!).map((t) => ({ id: t.from_id, to_id: t.to_id }));
  for (const row of rows) {
    const props = row.props ?? {};
    const { lens, lost } = oldQuery(ctx, props, about.filter((a) => a.from_id === row.id).map((a) => a.to_id));
    if (lens) (out.facts.push(['+', row.id, 'filter', fromBefore(lens.filter)], ['+', row.id, 'walk', lens.walk]), out.moved++);
    else (out.facts.push(['+', row.id, 'status', 'retired']), out.retired.push(row.id));
    const style = styles.find((s) => s.to_id === row.id);
    if (lens && style && props.style === undefined) out.facts.push(['+', row.id, 'style', { style: style.id }]);
    for (const field of OLD_FIELDS) if (field in props) out.facts.push(['-', row.id, field]);
    if (lost.length) out.lost[row.id] = lost;
  }
  return out;
}

/** Each view kept in the filter's words before its one list of terms, said in them (the owner, 30 Oct 2026): a change like any other, so the log keeps what it said (a migration, run once). */
export async function termQueries(ctx: KernelContext): Promise<number> {
  const before = (f: unknown) => (Array.isArray(f) ? !f.includes('find') : typeof f === 'object' && f !== null ? !('find' in f) : true);
  const views = (await ctx.reads({ marked: { types: ctx.registry.family(KEPT), keys: ['filter'] } })) as Row[];
  const facts = views.filter((r) => before(r.props?.filter)).map((r): Fact => ['+', r.id, 'filter', fromBefore(r.props!.filter as Props)]);
  // A screen kept on the map may hold a picture of a lens of its own.
  const screens = ((await ctx.reads({ marked: { types: ctx.registry.family('screen'), keys: ['pieces'] } })) as Row[]).filter((r) => Array.isArray(r.props?.pieces));
  for (const { id, props } of screens) {
    const pieces = props!.pieces as Props[];
    const old = (p: Props) => typeof p.lens === 'object' && p.lens !== null && 'filter' in p.lens && !('find' in ((p.lens as Props).filter as Props));
    if (pieces.some(old)) facts.push(['+', id, 'pieces', pieces.map((p) => (old(p) ? { ...p, lens: { ...(p.lens as Props), filter: fromBefore((p.lens as Props).filter as Props) } } : p))]);
  }
  if (facts.length) await ctx.move('lens.moved', 'Views kept are said in the one list of terms', facts);
  return facts.length;
}
