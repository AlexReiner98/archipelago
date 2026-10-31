// A view kept on the map (an item of core's lens type, called a canvas on the page): a flat lens and a style, about
// an item or about nothing. Its picture is the flat lens's answer (src/query-flat.ts) with the style it is drawn in; a
// document draws it where a line names it, publishing freezes it, and `get` says which of them an item is in.
//
// Views kept before the flat lens said what was in them with other fields (from, kinds, by, over, far, fold...). They
// are translated once, when a workspace opens (moveQueries): what a flat lens can say is kept, what it cannot is said
// in the log and taken off; one with nothing a filter can include is retired.

import { flatRead, fromBefore, LENS_LIMIT } from './query-flat.ts';
import { keptOf } from './query-kept.ts';
import { readSteps, stepIds } from './query-steps.ts';
import type { Fact } from './log.ts';
import type { Archipelago } from './pelago.ts';
import { drawn, ownStyle, styleFor } from './styles.ts';

const ITEM = /^e_[a-z0-9]{8}$/;
/** The type a view is kept as. */
const KEPT = 'lens';

type Props = Record<string, unknown>;
const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v !== '') : []);

/** The flat lens a kept view draws: its filter with its pins and what its steps name, its walk, its limit and its window of time. */
export function viewQuery(props: Props) {
  const filter = { ...((props.filter ?? {}) as Props) };
  const ids = [...list(props.pins), ...stepIds(props.steps)].map((id) => `id ${id}`);
  if (ids.length) filter.find = [...new Set([...list(filter.find), ...ids])];
  return { filter, walk: props.walk ?? { over: [], steps: 0 }, ...(typeof props.limit === 'number' && { limit: props.limit }), ...(props.time != null && { time: props.time }) };
}

/** Whether an item's type is a kept view. */
export const isKept = (l: Archipelago, type: string) => l.registry.isA(type, KEPT);

/**
 * The picture of a kept view: the flat lens's answer, and the style it is drawn in (the presets, the workspace's, its
 * own layout and settings, the style it names), with the drawing that style names;
 * and its steps, with what they name sent even where the filter leaves it out (a part that is gone is told of).
 */
export async function keptPicture(l: Archipelago, id: string, have?: unknown) {
  const item = await l.entity(id);
  if (!item || !isKept(l, item.type)) throw new Error(`"${id}" is not a view kept on the map`);
  const own = (item.props.style ?? {}) as Props;
  const named = typeof own.style === 'string' ? own.style : undefined;
  const { style } = await styleFor(l, await keptOf(l, 'style', named), { own: ownStyle(own), ...(named && { named }) });
  const lens = viewQuery(item.props);
  let answer = await flatRead(l, lens);
  const steps = item.props.steps === undefined ? undefined : readSteps(item.props.steps);
  const told = stepIds(item.props.steps).filter((id) => !answer.items.some((i) => i.id === id));
  // What a step names that was left out: read again with it, leaving nothing out but what was not sent, so the links among them all come too.
  if (told.length) answer = { ...(await flatRead(l, { filter: { find: [...answer.items.map((i) => i.id), ...told].map((id) => `id ${id}`), not: [] }, limit: Math.min(answer.items.length + told.length, LENS_LIMIT) })), lens: answer.lens };
  // It starts from what it is about, where it draws that; else from the one item it names (as the lens's from was).
  const { rows } = await l.db.query<{ to_id: string }>(`select to_id from relation where type = 'about' and from_id = $1 and valid_to is null order by id`, [id]);
  const ids = list((lens.filter as Props).ids);
  // Or what it draws what is in: the items it finds in or is narrowed within, and the ends of its link terms.
  const ends = [...list((lens.filter as Props).find), ...list((lens.filter as Props).only)].filter((t) => !/^(id|text|type|kind) /.test(t)).map((t) => t.split(/\s+/).slice(1).join(' '));
  const from = rows.map((r) => r.to_id).find((x) => ids.includes(x) || ends.includes(x)) ?? (ids.length === 1 ? ids[0] : undefined);
  return { ...answer, lens: { ...answer.lens, ...(from && { from }) }, ...(steps && { steps }), style: await drawn(l, style, have ?? []) };
}

/**
 * The views an item is drawn in: each view kept about something it sits in (its trail) whose lens reaches it, with
 * the documents that bring the view in. The way back from an item to the picture it was reached from.
 */
export async function shownIn(l: Archipelago, id: string, trail: { id: string; title: string; views: { id: string; title: string }[] }[]) {
  const shown: { id: string; title: string; of: { id: string; title: string }; documents: { id: string; type: string; title: string }[] }[] = [];
  for (const step of trail)
    for (const view of step.views) {
      const item = await l.entity(view.id);
      const answer = item && (await flatRead(l, viewQuery(item.props)).catch(() => undefined));
      if (!answer?.items.some((one) => one.id === id)) continue;
      const documents = (await l.mentionedIn(view.id)).filter((m) => l.registry.drawnWith('document').includes(m.type)).map((m) => ({ id: m.id, type: m.type, title: m.title }));
      shown.push({ id: view.id, title: view.title, of: { id: step.id, title: step.title }, documents });
    }
  return shown;
}

// ---- Views kept before the flat lens ------------------------------------------------------------------------------

/** The fields a view kept before the flat lens said what was in it with. */
export const OLD_FIELDS = ['from', 'controls', 'kinds', 'by', 'over', 'far', 'near', 'lanes', 'order', 'measure', 'fold', 'time'];
/** Each old field the flat lens has no word for, and why. */
const UNSAID: Record<string, string> = {
  controls: 'what the person may change on the page',
  lanes: 'lanes',
  order: 'an ordering field',
  measure: 'what size counts',
  time: 'a time axis',
  near: 'near',
};

/**
 * A view kept before the flat lens, as a flat lens: it starts from what it names (from) or is about, and from what
 * is part of that (its by), walks the links it sent along one step; of the whole map, it takes the types it kept.
 * The types it kept of what is in an item narrow it: those types within that item (every step down) or only those
 * types of what is part of it (a step), drawn in it as the frame, and not walked (the walk is not narrowed).
 * What is left out stays left out. `lost` says each thing it said that the flat lens cannot: a depth other than one
 * step or every step (the flat walk goes either way, so walking part_of further would climb to what holds it), what
 * the links of a narrowed view reached, unlinked, lanes, a time axis, controls...
 * Null when nothing in it says what a filter includes.
 */
export function oldQuery(l: Archipelago, props: Props, about: string[]): { lens: { filter: Props; walk: { over: string[] | 'all'; steps: number } } | null; lost: string[] } {
  const lost: string[] = [];
  const known = (t: string) => l.registry.types.has(t);
  const linked = (r: string) => l.registry.relations.has(r);
  const start = typeof props.from === 'string' && ITEM.test(props.from) ? [props.from] : about;
  if (typeof props.from === 'string' && !ITEM.test(props.from)) lost.push(`from "${props.from}"`);
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
  const within = narrowed && props.far === undefined && start.length === 1 && l.registry.relationFamily('part_of').includes(by);
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

/**
 * A migration, run when a workspace opens: each view kept before the flat lens is given the flat lens its fields say
 * (oldQuery) and its old fields are taken off, with what did not translate said in the log; one with nothing to
 * include is retired. A style kept about it stays the style it is drawn in. Returns what moved and what was lost.
 */
export async function moveQueries(l: Archipelago): Promise<{ moved: number; retired: string[]; lost: Record<string, string[]> }> {
  const { rows } = await l.db.query<{ id: string; title: string; props: Props }>(
    `select id, title, props from entity where type = any($1::text[]) and archived_at is null and props ?| $2::text[] -- index entity_type`,
    [l.registry.family(KEPT), OLD_FIELDS],
  );
  const out = { moved: 0, retired: [] as string[], lost: {} as Record<string, string[]> };
  if (!rows.length) return out;
  const { rows: about } = await l.db.query<{ from_id: string; to_id: string }>(`select from_id, to_id from relation where type = 'about' and valid_to is null and from_id = any($1::text[]) order by id`, [rows.map((r) => r.id)]);
  const { rows: styles } = await l.db.query<{ id: string; to_id: string }>(
    `select s.id, r.to_id from relation r join entity s on s.id = r.from_id where r.type = 'about' and r.valid_to is null and r.to_id = any($1::text[]) and s.type = any($2::text[]) and s.is_open and s.archived_at is null order by s.updated_at desc`,
    [rows.map((r) => r.id), l.registry.family('style')],
  );
  const facts: Fact[] = [];
  for (const row of rows) {
    const { lens, lost } = oldQuery(l, row.props, about.filter((a) => a.from_id === row.id).map((a) => a.to_id));
    if (lens) (facts.push(['+', row.id, 'filter', fromBefore(lens.filter)], ['+', row.id, 'walk', lens.walk]), out.moved++);
    else (facts.push(['+', row.id, 'status', 'retired']), out.retired.push(row.id));
    const style = styles.find((s) => s.to_id === row.id);
    if (lens && style && row.props.style === undefined) facts.push(['+', row.id, 'style', { style: style.id }]);
    for (const field of OLD_FIELDS) if (field in row.props) facts.push(['-', row.id, field]);
    if (lost.length) out.lost[row.id] = lost;
  }
  const reason = 'Views kept before the flat lens are flat lenses now: what each said that a flat lens cannot is in this event';
  await l.db.transaction(async (tx) => {
    await l.moved(tx, 'lens.moved', reason, facts);
    await l.log(tx, { actor: 'system', action: 'lens.moved', reason, detail: { moved: out.moved, retired: out.retired, lost: out.lost } });
  });
  return out;
}

/** Each view kept in the filter's words before its one list of terms, said in them (the owner, 30 Oct 2026): a change like any other, so the log keeps what it said (a migration, run once). */
export async function termQueries(l: Archipelago): Promise<number> {
  const { rows } = await l.db.query<{ id: string; filter: Props }>(
    `select id, props->'filter' as filter from entity where type = any($1::text[]) and archived_at is null and props ? 'filter' and not (props->'filter' ? 'find') -- index entity_type`,
    [l.registry.family(KEPT)],
  );
  const facts = rows.map((r): Fact => ['+', r.id, 'filter', fromBefore(r.filter)]);
  // A screen kept on the map may hold a picture of a lens of its own.
  const { rows: screens } = await l.db.query<{ id: string; pieces: Props[] }>(`select id, props->'pieces' as pieces from entity where type = any($1::text[]) and archived_at is null and jsonb_typeof(props->'pieces') = 'array' -- index entity_type`, [l.registry.family('screen')]);
  for (const { id, pieces } of screens) {
    const old = (p: Props) => typeof p.lens === 'object' && p.lens !== null && 'filter' in p.lens && !('find' in ((p.lens as Props).filter as Props));
    if (pieces.some(old)) facts.push(['+', id, 'pieces', pieces.map((p) => (old(p) ? { ...p, lens: { ...(p.lens as Props), filter: fromBefore((p.lens as Props).filter as Props) } } : p))]);
  }
  if (facts.length) await l.db.transaction((tx) => l.moved(tx, 'lens.moved', 'Views kept are said in the one list of terms', facts));
  return facts.length;
}
