// A lens says what is in a picture, and is answered with data of one fixed
// shape: the lens as it was read, items, links, and what was left out. How
// that data looks (a shape, colours, what is lit) is a style, chosen where it
// is drawn; nothing here knows about it. A thing with parts carries the same
// keys as a thing without, so one drawing can serve at every scale.

import { sayLens } from './lens-words.ts';
import type { Archipelago } from './pelago.ts';
import { placeAll, zoneOf } from './timeaxis.ts';
import { needsOf } from './attention.ts';
import { blockGraph } from './blocking.ts';
import { hubOf, keptOf, type Kept } from './lens-kept.ts';
import { styleFor, drawn as withDrawing } from './styles.ts'; import { SYSTEM } from './head.ts';
import { readSteps, stepIds } from './lens-steps.ts';
import { IN, SESSIONS, WHEN, dated, insideOf, personLanes, streamsOf, thisWeek } from './lens-when.ts';
import { LENS_DEFAULT, ofKind, readLens, topKinds, viewLens, WAITS, wholeRead, type Lens } from './lens-read.ts';
import { aroundOf } from './lens-scan.ts';
import { scanAround, scanKinds, type Row } from './region.ts';
import { holders } from './inside.ts';

// Kept where they were first imported from.
export { hubs, HUB_AT, pictureOf } from './lens-kept.ts';
export { LENS_DEFAULT, readLens, type Lens } from './lens-read.ts';

/** What a view may let the person looking change on the page. */
const CONTROLS = ['lit', 'far', 'closed', 'time'];
/** The most items one answer sends: the deepest are cut first, and `rest` says how many. */
export const LENS_LIMIT = 2000;
/** Statuses that mean someone is on it now. */
const UNDER_WAY = ['doing', 'building', 'investigating'];


interface Counts {
  items: number;
  work: number;
  blocked: number;
  waiting: number;
  sessions: number;
  tokens: { estimated: number; used: number };
  /** How many of them wait on each person, and how many need the person it is answered for (by attention's reasons). */
  waits_on: Record<string, number>; needs_you: number;
  /** How many of them are not among the items of this answer. */
  not_sent: number;
}

/**
 * The pictures an item is drawn in: each view kept about something it sits in (its trail), where that view's answer
 * has it, with the documents that bring the view in. The way back from an item to the picture it was reached from.
 */
export async function shownIn(l: Archipelago, id: string, trail: { id: string; title: string; views: { id: string; title: string }[] }[]) {
  const shown: { id: string; title: string; of: { id: string; title: string }; documents: { id: string; type: string; title: string }[] }[] = [];
  for (const step of trail)
    for (const view of step.views) {
      const answer = await lens(l, { lens: view.id }).catch(() => undefined);
      if (!answer?.items.some((item) => item.id === id)) continue;
      const documents = (await l.mentionedIn(view.id)).filter((m) => l.registry.drawnWith('document').includes(m.type)).map((m) => ({ id: m.id, type: m.type, title: m.title }));
      shown.push({ id: view.id, title: view.title, of: { id: step.id, title: step.title }, documents });
    }
  return shown;
}

/** The view every item that waits on something has: all it waits on, step by step, and nothing else, as a flow. */
export const HOLDING = 'holding';

/** A beat of a session's story, as the tell tool keeps it on the run. */
interface Beat {
  n: number;
  about: string[];
  links: { from: string; to: string; says: string }[];
  replaced_by?: number;
}

/** The story a run told: the run, and its beats that stand (not taken back). By its id or by the id its surface gave it. */
async function storyOf(l: Archipelago, key: string): Promise<{ id: string; title: string; beats: Beat[] }> {
  const { rows } = await l.db.query<{ id: string; title: string; story: unknown }>(
    `select id, title, props->'story' as story from entity where type = any($1::text[]) and archived_at is null and (id = $2 or props->>'session_id' = $2) order by is_open desc, created_at desc limit 1`,
    [l.registry.family('sys.run'), key],
  );
  if (!rows.length) throw new Error(`No session "${key}" to draw the story of`);
  const beats = Array.isArray(rows[0].story) ? (rows[0].story as Beat[]) : [];
  return { id: rows[0].id, title: rows[0].title, beats: beats.filter((b) => !b.replaced_by) };
}

/**
 * What a lens answers with: the lens as read, the items, the links between them, and what was left out. Asked with a
 * preset (a view a pack declares as a lens: src/lens-presets.ts), the preset is the view: no lens or style kept on the
 * map goes in, and what only a page needs (its style, the views to choose from, what needs the person looking) is left out.
 * A preset that reads no `rest` asks for it uncounted.
 */
export async function lens(l: Archipelago, input: Record<string, unknown>, preset?: Record<string, unknown>, counted = true) {
  // A story is drawn under no view of its own: the workspace's views are pictures of the map, not of what a session said.
  const told = input.story === undefined ? undefined : await storyOf(l, String(input.story));
  // One beat of it, where one is asked for: a finding is drawn alone.
  if (told && input.beat !== undefined) {
    const one = told.beats.find((b) => b.n === input.beat);
    if (!one) throw new Error(`No beat ${input.beat} stands in the story of "${told.title}"`);
    told.beats = [one];
  }
  // "around" (what an item is tied to, by every kind of link) was a view of its own until 18 Oct; asked for in an old address, it is no view at all.
  if (input.lens === 'around') input = { ...input, lens: undefined };
  const builtIn = input.from !== undefined && [HOLDING, WHEN, IN].includes(input.lens as string);
  const [lenses, styles] = preset ? [[], []] : [await keptOf(l, 'lens', builtIn ? undefined : input.lens), await keptOf(l, 'style', input.style)];
  // A view asked for by its id alone starts where it is kept: from the item it is about, or the one it names.
  const named = input.from === undefined && !told && typeof input.lens === 'string' ? lenses.find((one) => one.id === input.lens) : undefined;
  const startsAt = typeof named?.props.from === 'string' ? named.props.from : named?.about.length === 1 ? named.about[0] : undefined;
  if (startsAt !== undefined) input = { ...input, from: startsAt };
  // The item the picture is asked for. Each lens kept about it is a view of it, with a name; the first in order is the one it opens on.
  const hub = input.from === undefined ? undefined : String(input.from);
  const placed = (one: Kept) => (typeof one.props.place === 'number' ? one.props.place : Infinity);
  // Every lens that applies can be chosen: those about the item, then what holds it, then the workspace's own (about nothing), each in its order.
  const own = hub === undefined ? [] : lenses.filter((one) => one.about.includes(hub)).sort((a, b) => placed(a) - placed(b));
  const shared = lenses.filter((one) => !one.about.length).sort((a, b) => placed(a) - placed(b));
  const views = told ? [] : [...own, ...shared];
  // A preset is known before anything is read: what it folds away, and the links it does not send, are not read at all.
  const early = preset && readLens(l, input, readLens(l, preset));
  // A lens from an item reads what is around it, for any view of it that may be chosen (one that goes near, what it
  // walks to as well); a story, what it is about; one of the whole map, the items of the kinds it names, and no more.
  const scoped = hub !== undefined && !told;
  // Of the whole map, a lens that names no kinds to keep opens on its top: what is at the altitude of a project or above.
  const whole = !scoped && !told ? (early ?? readLens(l, input, viewLens(l, typeof input.lens === 'string' ? lenses.find((one) => one.id === input.lens) : shared[0], LENS_DEFAULT))) : undefined;
  if (whole && !(whole.kinds ?? []).some((k) => !k.startsWith('-'))) input = { ...input, kinds: [...topKinds(l), ...(whole.kinds ?? [])] };
  const toldOf = told ? [...new Set(told.beats.flatMap((b) => b.about))] : [];
  const { entities, relations, unread, more, tied: organised } = scoped
    ? { ...(await scanAround(l, aroundOf(l, hub, input, early, [...own, ...lenses.filter((one) => one.id === input.lens)]))), more: 0, tied: new Set<string>() }
    : told
      ? { ...(await scanAround(l, { starts: toldOf, by: [], over: [], waits: [], narrow: true })), more: 0, tied: new Set<string>() }
      : await scanKinds(l, wholeRead(l, readLens(l, input, early ?? viewLens(l, typeof input.lens === 'string' ? lenses.find((one) => one.id === input.lens) : shared[0], LENS_DEFAULT))));
  const all = new Map(entities.map((e) => [e.id, e]));
  // What the item waits on, step by step through what that waits on, finished or not: the view of what holds it,
  // offered beside the others while some of it is still open, and the one an item opens on when it has none of its own.
  const waitsOn = new Map<string, string[]>();
  for (const r of relations) if (WAITS.includes(l.registry.relations.get(r.type)?.root ?? r.type)) waitsOn.set(r.from_id, [...(waitsOn.get(r.from_id) ?? []), r.to_id]);
  const held = new Set<string>();
  for (const queue = hub === undefined ? [] : [hub]; queue.length; ) for (const to of waitsOn.get(queue.pop()!) ?? []) if (to !== hub && !held.has(to)) (held.add(to), queue.push(to));
  const offered = !told && !preset && [...held].some((id) => all.get(id)?.is_open);
  if (offered) views.splice(own.length, 0, { id: HOLDING, title: 'What holds it', props: {}, about: [] });
  // When things inside it happen: offered beside the rest while anything in it has a place in time.
  const zone = await zoneOf(l);
  const timed = !told && !preset && hub !== undefined && dated(l, hub, LENS_DEFAULT.by, entities, relations, zone);
  if (timed) views.splice(own.length + (offered ? 1 : 0), 0, { id: WHEN, title: 'When', props: {}, about: [] });
  const when = timed && input.lens === WHEN;
  // In it, what each thing counts toward: a calendar colours by it. A session's stretch counts toward the work it was on.
  const streamOf = when ? streamsOf(l, hub!, LENS_DEFAULT.by, relations) : undefined;
  const holding = hub !== undefined && (input.lens === HOLDING || (offered && input.lens === undefined && !own.some((one) => typeof one.props.from !== 'string')));
  // An item opens on its first picture of its own (not a shortcut, which leads away), else on what holds it, else on what is in it; the whole map on the workspace's first.
  const view = holding || when || (told && typeof input.lens !== 'string') ? undefined : typeof input.lens === 'string' ? lenses.find((one) => one.id === input.lens) : hub === undefined ? shared[0] : own.find((one) => typeof one.props.from !== 'string');
  // A view may start somewhere else than the item it is kept about: tightly scoped, that is a shortcut.
  // Asked for by its id alone, a view kept about one item starts from that item, so it can be drawn anywhere: in a document, for one.
  const start = typeof view?.props.from === 'string' ? view.props.from : (hub ?? (view && view.about.length === 1 ? view.about[0] : undefined));
  // A story's items are tied by whatever the map ties them by, and what is finished stays: it was told of.
  // What holds one item is what it waits on and what that waits on, tied by those links alone.
  let under: Lens = told ? { ...LENS_DEFAULT, over: 'all', fold: ['system'] } : holding ? { ...LENS_DEFAULT, over: [...WAITS] } : when ? { ...LENS_DEFAULT, over: [], lanes: 'person', fold: [], time: thisWeek(zone) } : preset ? readLens(l, preset) : LENS_DEFAULT;
  // One view at a time, over what is built in: a field it does not name is the built-in one.
  const read = view ? [view] : [];
  under = viewLens(l, view, under);
  const asked = readLens(l, { ...input, ...(start !== undefined && { from: start }), ...(told && { story: told.id, from: undefined }) }, under);
  // What the story is about, in the order it came to them; and for each, the beats that are about it.
  // A view's steps name what was once in it: sent with it whatever it folds away (src/lens-steps.ts).
  const about = told ? toldOf : view ? stepIds(view.props.steps) : [];
  const beatsOf = (id: string) => (told ? told.beats.filter((b) => b.about.includes(id)).map((b) => b.n) : []);
  // A style is passed on as it is kept: only the page that draws reads it. The packs' presets, then the workspace's, the item's kind's, the item's, this view's, one named.
  // Asked for by its id alone (in a document), a view is drawn as the item it starts from is.
  const styled = hub ?? start;
  const hubType = styled === undefined ? undefined : all.get(styled)?.type;
  const { style, used: drawn } = preset ? { style: {}, used: [] } : await styleFor(l, styles, { ...(hubType && { hub: { id: styled!, type: hubType } }), ...(view && { view: view.id }), named: input.style });
  // What holds an item is drawn as a flow, whatever the item's own pictures are drawn as.
  if (holding) (delete style.code, (style.shape = 'flow'));
  // And when things happen, as a calendar of days, each person a lane.
  if (when) (delete style.code, (style.shape = 'time'), (style.layout = 'calendar'));
  if (asked.from && !all.has(asked.from)) throw new Error(`No item "${asked.from}"`);

  const isA = (type: string, kind: string) => l.registry.isA(type, kind);
  // The system kind (a lens, a style, a run) is how the map is kept and looked at, not part of what is seen.
  const system = (e: Row) => e.kind === SYSTEM;
  // What is work: what can be estimated, and what such things are part of.
  const work = (type: string) => ofKind(l, type, 'work');
  const wanted = (asked.kinds ?? []).filter((k) => !k.startsWith('-'));
  const unwanted = (asked.kinds ?? []).filter((k) => k.startsWith('-')).map((k) => k.slice(1));
  const is = (type: string, kind: string) => ofKind(l, type, kind);
  const rest = { closed: unread.closed, system: unread.system, kinds: 0, unlinked: 0, far: 0, limit: more };

  const eligible = new Map<string, Row>();
  // What stands on the map for this picture before kinds are chosen: the ladder a thing is found on when what holds it is not of the kinds kept.
  const standing = new Set<string>();
  for (const e of entities) {
    if (e.id === asked.from || about.includes(e.id)) (eligible.set(e.id, e), standing.add(e.id));
    else if (asked.fold.includes('system') && system(e)) rest.system++;
    else if (asked.fold.includes('closed') && !e.is_open) rest.closed++;
    else if ((wanted.length && !wanted.some((k) => is(e.type, k))) || unwanted.some((k) => is(e.type, k))) (rest.kinds++, standing.add(e.id));
    else (eligible.set(e.id, e), standing.add(e.id));
  }
  // On a time axis, only what falls in its window stays (and where it starts).
  const spans = asked.time && (await placeAll(l, [...eligible.values()], asked.time, zone));
  let untimed = 0;
  if (spans) for (const [id, found] of spans) if (!found.length && id !== asked.from) (eligible.delete(id), untimed++);
  const live = relations.filter((r) => eligible.has(r.from_id) && eligible.has(r.to_id));

  // What a thing is inside: where its organising link leads, up past what is not of the kinds kept (src/inside.ts).
  const { parent, depths, kids } = holders(relations, asked.by, standing, eligible, asked.from);

  // Which of them are sent.
  const along = (type: string) => asked.over === 'all' || asked.over.includes(type);
  let sent = new Set<string>();
  if (told) {
    // Only what the story is about: it is what the session chose to show.
    for (const id of about) if (eligible.has(id)) sent.add(id);
  } else if (holding) {
    for (const id of [hub!, ...held]) if (eligible.has(id)) sent.add(id);
  } else if (asked.from && asked.near !== undefined) {
    // What the start is tied to, step by step along the links sent, either way.
    sent.add(asked.from);
    for (let step = 0, frontier = [asked.from]; step < asked.near && frontier.length; step++) {
      const at = new Set(frontier);
      frontier = [];
      for (const r of live) if (along(r.type)) for (const [a, b] of [[r.from_id, r.to_id], [r.to_id, r.from_id]]) if (at.has(a) && !sent.has(b)) (sent.add(b), frontier.push(b));
    }
  } else if (asked.from) {
    // Down from the start, as far as asked; then whatever a link that is sent along ties to one of those.
    const reach = (id: string, steps: number) => {
      sent.add(id);
      for (const kid of kids.get(id) ?? []) {
        if (sent.has(kid)) continue;
        if (asked.far !== undefined && steps >= asked.far) rest.far++;
        else reach(kid, steps + 1);
      }
    };
    reach(asked.from, 0);
    // When things happen: the sessions that worked on anything inside it too (dated or not), where they were at work on it.
    const within = when && insideOf(l, asked.from, asked.by, relations);
    if (within && spans) for (const [id, found] of spans) if (found.some((span) => span.on && within.has(span.on))) sent.add(id);
    const tree = new Set(sent);
    // Brought in: whatever a link ties to the start itself, and what blocks or is blocked by anything inside it.
    // Not every neighbour of everything inside: a project's picture is not its whole surroundings.
    for (const r of live) {
      if (!along(r.type) || !(r.from_id === asked.from || r.to_id === asked.from || WAITS.includes(l.registry.relations.get(r.type)?.root ?? r.type))) continue;
      if (tree.has(r.from_id)) sent.add(r.to_id);
      // Not what is inside one of them, though: that is what `far` cut.
      if (tree.has(r.to_id) && r.type !== asked.by) sent.add(r.from_id);
    }
  } else {
    for (const id of eligible.keys()) {
      if (asked.fold.includes('unlinked') && !parent.has(id) && !kids.has(id) && !organised.has(id)) rest.unlinked++;
      else if (asked.far !== undefined && depths.get(id)! > asked.far) rest.far++;
      else sent.add(id);
    }
  }
  if (sent.size > LENS_LIMIT) {
    const kept = [...sent].sort((a, b) => depths.get(a)! - depths.get(b)!).slice(0, LENS_LIMIT);
    rest.limit += sent.size - kept.length;
    sent = new Set(kept);
  }

  // The state of each thing, and the same counted over everything inside it, sent or not.
  // What blocks what is read from what was read, along every chain of waiting, wherever it leads.
  const blocked = await blockGraph(l, [...all.keys()]);
  // What needs the person it is answered for: what waits on them, theirs to confirm, due, or unsettled and theirs.
  const viewer = l.viewer || (await l.setting<string>('me')) || null, yours = preset ? new Set<string>() : await needsOf(l, viewer, { entities, relations, graph: blocked });
  const { rows: at } = await l.db.query<{ target: string }>(
    `select r.to_id as target from relation r join entity s on s.id = r.from_id
     where r.type = 'sys.works_on' and r.valid_to is null and s.is_open and s.archived_at is null and r.to_id = any($1::text[])`,
    [[...all.keys()]],
  );
  const sessions = new Map<string, number>();
  for (const { target } of at) sessions.set(target, (sessions.get(target) ?? 0) + 1);
  const state = (e: Row) => ({
    blocked: blocked.isBlocked(e.id),
    waits_on: (blocked.direct.get(e.id) ?? []).filter((edge) => edge.why === 'waits_on').map((edge) => edge.y),
    sessions: sessions.get(e.id) ?? 0,
    needs_you: yours.has(e.id),
  });
  const size = (e: Row) => ({ work: work(e.type) && e.is_open ? 1 : 0, tokens: { estimated: Number(e.props.tokens_estimated ?? 0), used: Number(e.props.tokens_used ?? 0) } });
  const totals = new Map<string, Counts>();
  const within = (id: string): Counts => {
    const known = totals.get(id);
    if (known) return known;
    const sum: Counts = { items: 0, work: 0, blocked: 0, waiting: 0, sessions: 0, tokens: { estimated: 0, used: 0 }, waits_on: {}, needs_you: 0, not_sent: 0 };
    totals.set(id, sum);
    for (const kid of kids.get(id) ?? []) {
      const e = eligible.get(kid)!;
      const [own, big, inner] = [state(e), size(e), within(kid)];
      sum.items += 1 + inner.items;
      sum.work += big.work + inner.work;
      sum.blocked += (own.blocked ? 1 : 0) + inner.blocked;
      sum.waiting += (own.waits_on.length ? 1 : 0) + inner.waiting;
      sum.needs_you += (own.needs_you ? 1 : 0) + inner.needs_you;
      sum.sessions += own.sessions + inner.sessions;
      sum.tokens.estimated += big.tokens.estimated + inner.tokens.estimated;
      sum.tokens.used += big.tokens.used + inner.tokens.used;
      for (const who of own.waits_on) sum.waits_on[who] = (sum.waits_on[who] ?? 0) + 1;
      for (const [who, n] of Object.entries(inner.waits_on)) sum.waits_on[who] = (sum.waits_on[who] ?? 0) + n;
      sum.not_sent += (sent.has(kid) ? 0 : 1) + inner.not_sent;
    }
    return sum;
  };

  // Its place among the things beside it: by the ordering field where it has one, then as they were written down.
  const inside = (id: string) => (parent.has(id) && sent.has(parent.get(id)!) ? parent.get(id)! : null);
  const beside = new Map<string, Row[]>();
  for (const id of sent) beside.set(inside(id) ?? '', [...(beside.get(inside(id) ?? '') ?? []), eligible.get(id)!]);
  const place = new Map<string, number>();
  const ordered = (e: Row) => (typeof e.props[asked.order] === 'number' ? (e.props[asked.order] as number) : Infinity);
  for (const group of beside.values()) {
    group.sort((a, b) => ordered(a) - ordered(b) || +new Date(a.created_at) - +new Date(b.created_at) || a.title.localeCompare(b.title));
    group.forEach((e, i) => place.set(e.id, i + 1));
  }

  // What it is filed under, when the lens has lanes.
  const tied = new Map<string, string>();
  // The kind of link, and which way it runs: "depends_on" where the start depends on it, "depends_on:in" where it depends on the start.
  if (asked.lanes === 'link' && asked.from) for (const r of live) for (const [a, b, way] of [[r.from_id, r.to_id, ''], [r.to_id, r.from_id, ':in']]) if (a === asked.from && !tied.has(b)) tied.set(b, r.type + way);
  const byField = asked.lanes?.startsWith('field:') ? asked.lanes.slice(6) : undefined;
  const lane = (e: Row): string | null => {
    if (byField !== undefined) return e.props[byField] == null ? null : String(e.props[byField]);
    if (asked.lanes === 'person') return isA(e.type, 'sys.run') ? SESSIONS : e.owner;
    if (asked.lanes === 'link') return tied.get(e.id) ?? null;
    if (!e.is_open) return 'done';
    return (sessions.get(e.id) ?? 0) > 0 || Number(e.props.tokens_used ?? 0) > 0 || UNDER_WAY.includes(e.status) ? 'under_way' : 'to_come';
  };

  // The fields a type's pack marks as shown travel with the item, so a style can draw by them; a question's choices too.
  const shownFields = (e: Row) => {
    const type = l.registry.type(e.type), defs = type?.fields ?? {}, choices = e.props[type?.capabilities.settles?.choices ?? ''];
    const fields = Object.fromEntries(Object.entries(e.props).filter(([key, value]) => defs[key]?.shown && value != null));
    return { ...(Object.keys(fields).length && { fields }), ...(Array.isArray(choices) && { choices: choices.map(String) }) };
  };
  // Filed by a field that has a set of values, the lanes come in that order: the first type that declares them says it.
  const laneOrder = asked.lanes === 'person' ? personLanes([...sent].map((id) => lane(eligible.get(id)!)), all) : byField === undefined ? undefined : [...l.registry.types.values()].find((t) => t.fields[byField]?.values)?.fields[byField].values;

  // A link whose end was not sent is moved up to the nearest thing that was, so one line can stand for several.
  // Not in what holds an item, though: there a link says what waits on what, and one lifted would say what does not.
  const lift = (id: string): string | undefined => {
    if (holding || asked.near !== undefined) return sent.has(id) ? id : undefined;
    for (let cur: string | undefined = id, steps = 0; cur !== undefined && steps < 64; cur = parent.get(cur), steps++) if (sent.has(cur)) return cur;
    return undefined;
  };
  const lines = new Map<string, { kind: string; from: string; to: string; n: number; says?: string; state?: string; beat?: number }>();
  // The ties the session drew are links of their own kind, each with its words and the beat that said it.
  if (told)
    for (const b of told.beats)
      for (const k of b.links) if (sent.has(k.from) && sent.has(k.to)) lines.set(`said ${k.from} ${k.to} ${k.says}`, { kind: 'said', from: k.from, to: k.to, n: 1, says: k.says, beat: b.n });
  // Between two things a session tied, its words say what the map's own link would.
  const tiedBySession = new Set([...lines.values()].flatMap((k) => [`${k.from} ${k.to}`, `${k.to} ${k.from}`]));
  for (const r of live) {
    if (!along(r.type)) continue;
    const [from, to] = [lift(r.from_id), lift(r.to_id)];
    if (!from || !to || from === to || tiedBySession.has(`${from} ${to}`)) continue;
    // What is inside what is already said by `inside`.
    if (r.type === asked.by && inside(from) === to) continue;
    const key = `${r.type} ${from} ${to}`;
    const line = lines.get(key) ?? { kind: r.type, from, to, n: 0, ...(r.says && { says: r.says }), ...(r.state && { state: r.state }) };
    // A line that stands for several links says something, or is in a state, only when they all are the same.
    if (line.n > 0 && line.says !== (r.says ?? undefined)) delete line.says;
    if (line.n > 0 && line.state !== (r.state ?? undefined)) delete line.state;
    line.n++;
    lines.set(key, line);
  }

  return {
    lens: asked, ...(view && Array.isArray(view.props.steps) && { steps: readSteps(view.props.steps) }),
    style: preset ? style : await withDrawing(l, asked.time ? { ...style, shape: 'time' } : style, input.have), // drawn along its time axis, if it has one
    // Which lenses and styles kept on the map went into those two, the one that weighs most last.
    kept: { lens: read.map(({ id, title }) => ({ id, title })), style: drawn },
    // The lens in words: the rule a person reads on the page and an agent reads here.
    said: holding ? `What "${all.get(hub!)?.title}" waits on, step by step` : when ? `When what is in "${all.get(hub!)?.title}" happens, by day and by person` : sayLens(l, asked, told ? told.title : asked.from ? all.get(asked.from)?.title : undefined),
    // The lenses that can be chosen for this picture, in order, and which this is. One that starts somewhere else is a shortcut to there.
    views: views.map((one) => ({ id: one.id, title: one.title, ...(typeof one.props.from === 'string' && one.props.from !== hub && { to: { id: one.props.from, title: all.get(one.props.from)?.title ?? one.props.from } }) })),
    view: view?.id ?? (holding ? HOLDING : when ? WHEN : null),
    ...(hub !== undefined && !preset && {
      views_of_it: own.length,
      hub: await hubOf(l, hub),
    }),
    // What the person looking may change on the page, where the view says.
    // A story is what the session chose to show: there is nothing to light by but what it says.
    controls: told ? [] : holding ? ['lit', 'closed'] : when ? ['time'] : Array.isArray(view?.props.controls) ? (view!.props.controls as unknown[]).filter((c) => CONTROLS.includes(c as string)) : [],
    // Who it was answered for, so a style can light what needs them.
    viewer,
    items: [...sent].sort((a, b) => (told ? about.indexOf(a) - about.indexOf(b) : 0)).map((id) => {
      const e = eligible.get(id)!;
      return {
        id,
        type: e.type,
        ...l.registry.ancestry(e.type),
        title: e.title,
        status: e.status,
        open: e.is_open,
        inside: inside(id),
        place: place.get(id)!,
        ...(asked.lanes && { lane: lane(e) }),
        ...shownFields(e),
        size: size(e),
        state: state(e),
        within: within(id),
        ...(spans && { time: spans.get(id)!.map((span) => (streamOf && span.on ? { ...span, on_title: all.get(span.on)?.title, stream: streamOf.get(span.on) ?? null } : span)) }),
        ...(streamOf && { stream: streamOf.get(id) ?? null }),
        // In a story: the beats that are about it.
        ...(told && { told: beatsOf(id) }),
      };
    }),
    links: [...lines.values()],
    ...(laneOrder && { lanes: laneOrder }),
    ...(streamOf && { streams: [...new Set(streamOf.values())].map((key) => ({ key, title: all.get(key)?.title ?? key })) }),
    rest: spans ? { ...rest, time: untimed } : rest,
  };
}
