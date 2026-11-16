// The page answers an edit of the query itself first, where it can (task e_hygj7ybc). An edit that only narrows what
// the canvas holds (a term added to Only or Not, a term taken out of Find) is drawn at once from the items and links
// the page already holds, and the server's answer replaces that drawing when it comes. The page never guesses: it
// works the answer out the way the server does (packs/surface/kernel/packreads-flat.ts: seeds, a walk, the sessions at
// work), first proves it gets the answer it holds from the query it holds, and decides each new term exactly, from
// the item itself or from what the server said of it while find offered it (`hear`); anything else waits for the server.

/** What the server answered of the terms find offered, by `<part> <term>`: of which drawn items each holds. */
const heard = new Map();
/** How many terms' answers are kept: the newest, as find offers them. */
const heardMost = 200;

/**
 * Keep what a preview read answered (`flat` with `preview`, asked by find for the choices it offers): for Only, the
 * drawn items each term would leave out; for Not, those it would take away. Asked of the map as it was then.
 */
export function hear(params, value) {
  const asked = params?.preview;
  const said = value?.preview;
  if (!asked || !said || typeof said !== 'object' || !['only', 'not'].includes(asked.part) || !Array.isArray(asked.ids)) return;
  const ids = new Set(asked.ids);
  for (const term of Array.isArray(asked.terms) ? asked.terms : []) {
    if (!Array.isArray(said[term])) continue;
    heard.delete(`${asked.part} ${term}`);
    heard.set(`${asked.part} ${term}`, { ids, said: new Set(said[term]) });
  }
  while (heard.size > heardMost) heard.delete(heard.keys().next().value);
}

/** The map moved: what was heard of it may no longer hold. */
export const unheard = () => heard.clear();

const lower = (s) => String(s ?? '').replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * Whether a term of Only or Not holds of an item: true, false, or undefined when the page cannot say exactly. `ctx` is
 * { viewer, typeKnown(t), systemType(t) }.
 */
export function holds(part, term, item, ctx = {}) {
  const told = heard.get(`${part} ${term}`);
  if (told?.ids.has(item.id)) return part === 'not' ? told.said.has(item.id) : !told.said.has(item.id);
  const s = String(term).trim().replace(/\s+/g, ' ');
  const [, head = '', rest = ''] = /^(\S+)(?: (.*))?$/.exec(s) ?? [];
  const word = head.toLowerCase();
  const lineage = [item.type, ...(item.is ?? [])];
  if (/^done$/i.test(s)) return !item.open;
  if (/^no owner$/i.test(s)) return item.owner == null;
  if (word === 'status' && rest) return item.status === rest;
  if (word === 'id' && /^e_[a-z0-9]+$/.test(rest)) return item.id === rest;
  if (word === 'owner' && rest === 'me') return ctx.viewer ? item.owner === ctx.viewer : undefined;
  if (word === 'owner' && /^e_[a-z0-9]+$/.test(rest)) return item.owner === rest;
  if (word === 'type' && ctx.typeKnown?.(rest)) return lineage.includes(rest);
  if (/^kind system$/i.test(s) && ctx.systemType && ctx.typeKnown?.(item.type)) return Boolean(ctx.systemType(item.type));
  // The search's own match, as far as the page can say it: the words as typed in the title (ilike folds at least
  // ASCII), never the words in another form or in the note, which only the server's index can say.
  if (word === 'text' && rest && /^[\x20-\x7e]+$/.test(rest) && !/[%_\\]/.test(rest) && lower(item.title).includes(lower(rest))) return true;
  return undefined;
}

// ---- The answer worked out as the server works it out -----------------------------------------------------------

/** The order the server reads Find's terms in, by their first word, and what it says found an item. */
const CLASSES = [
  [/^id\b/i, 'id'],
  [/^(?:held|moved|frontier)$/i, 'id'],
  [/^worked\b/i, 'link'],
  [null, 'link'],
  [/^(?:in|island)\b/i, 'in'],
  [/^text\b/i, 'text'],
  [/^type\b/i, 'type'],
];
const classOf = (term) => {
  const i = CLASSES.findIndex(([re], n) => n !== 3 && re.test(term));
  return i < 0 ? 3 : i;
};
const isA = (item, type) => item.type === type || Boolean(item.is?.includes(type));
const linkIs = (link, type) => link.type === type || Boolean(link.is?.includes(type));
const newest = (a, b) => (a.updated_at === b.updated_at ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.updated_at < b.updated_at ? 1 : -1);
/** The most sessions at work the server sends with an answer (SESSIONS_MOST, packs/surface/kernel/packreads-flat.ts). */
const sessionsMost = 8;

/**
 * Why each item is in the answer of `lens` ({ find, walk, limit, sessions }, its terms as the server says them), worked
 * out from `items` and `links` held: [{ id, found, terms } | { id, step }] in the server's order, or null where the
 * answer would be cut. `seedOk` and `ok` are what Only asks of a seed and Not of every item reached.
 */
export function workedOut({ items, links }, lens, seedOk = () => true, ok = () => true) {
  const byId = new Map(items.map((i) => [i.id, i]));
  const order = new Map(lens.find.map((t, n) => [t, n]));
  const rank = (t) => [classOf(t), order.get(t)];
  const before = (a, b) => a[0] - b[0] || a[1] - b[1];
  const seeds = [];
  for (const item of items) {
    const terms = (item.terms ?? []).filter((t) => order.has(t)).sort((a, b) => before(rank(a), rank(b)));
    if (item.found && terms.length && seedOk(item) && ok(item)) seeds.push({ item, terms, first: rank(terms[0]) });
  }
  // Seeds in the order the server reads the terms that find them; what one term finds, in the order it was sent.
  const at = new Map(items.map((i, n) => [i.id, n]));
  seeds.sort((a, b) => before(a.first, b.first) || at.get(a.item.id) - at.get(b.item.id));
  const out = seeds.map(({ item, terms }) => ({ id: item.id, found: [...new Set(terms.map((t) => CLASSES[classOf(t)][1]))], terms }));
  const sent = new Set(out.map((o) => o.id));
  // The walk: a step at a time from the last step, along the links named, each its way, to what Not keeps.
  const ways = lens.walk?.over === 'all' ? [{ link: null, way: 'either' }] : (lens.walk?.over ?? []).map((t) => ({ link: t.replace(/[<>]$/, ''), way: t.endsWith('>') ? 'out' : t.endsWith('<') ? 'in' : 'either' }));
  let level = [...sent];
  for (let n = 0; level.length && n < (lens.walk?.steps ?? 0) && ways.length; n++) {
    const from = new Set(level);
    const next = new Map();
    for (const l of links) {
      for (const { link, way } of ways) {
        if (link && !linkIs(l, link)) continue;
        if (way !== 'in' && from.has(l.from) && !sent.has(l.to)) next.set(l.to, true);
        if (way !== 'out' && from.has(l.to) && !sent.has(l.from)) next.set(l.from, true);
      }
    }
    level = [...next.keys()].map((id) => byId.get(id)).filter((i) => i && ok(i)).sort(newest).map((i) => i.id);
    for (const id of level) (sent.add(id), out.push({ id, step: n + 1 }));
  }
  // The sessions at work on what is sent: the open runs linked works_on to it, the newest first, a few at most.
  if (lens.sessions !== false && sent.size) {
    const room = Math.min(sessionsMost, lens.limit - sent.size);
    const working = new Set(links.filter((l) => linkIs(l, 'works_on') && sent.has(l.to)).map((l) => l.from));
    const runs = items.filter((i) => working.has(i.id) && !sent.has(i.id) && isA(i, 'run') && i.open && ok(i)).sort(newest);
    // As many as the server may send, or more held than it sent: what it would send now is its to say.
    if (runs.length >= sessionsMost || runs.length >= lens.limit - sent.size) return null;
    for (const i of runs.slice(0, Math.max(0, room))) (sent.add(i.id), out.push({ id: i.id, step: 1 }));
  }
  return sent.size > lens.limit ? null : out;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Whether every Find term's read came back under its limit: the server reads a term with room for what the limit
 * leaves after the terms read before it, plus one, so a read that filled it may have left out what it would find.
 */
function completeReads(items, find, limit) {
  const order = new Map(find.map((t, n) => [t, n]));
  const rank = (t) => classOf(t) * find.length + order.get(t);
  const first = items.filter((i) => i.found).map((i) => Math.min(...(i.terms ?? []).filter((t) => order.has(t)).map(rank)));
  return find.every((t) => {
    const found = items.filter((i) => i.terms?.includes(t)).length;
    const before = first.filter((r) => r < rank(t)).length;
    return found + before <= limit;
  });
}
const has = (list, t) => list.includes(t);

/**
 * The answer of the query `next`, worked out from the answer of `was` the page holds (`answer`, as the store gives it;
 * `said`, the lens as the server read it), or null when only the server can say. `ctx` as for holds.
 */
export function narrowed(was, next, answer, said, ctx = {}) {
  if (!was?.filter || !next?.filter || was.view || next.view || was.time || next.time || answer.cut || !said) return null;
  const walkOf = (l) => ({ over: l.walk?.over ?? [], steps: l.walk?.steps ?? (l.walk?.over?.length ? 1 : 0) });
  if (!same(walkOf(was), walkOf(next)) || was.limit !== next.limit || (was.sessions ?? true) !== (next.sessions ?? true)) return null;
  const [f0, f1] = [was.filter.find ?? [], next.filter.find ?? []];
  const [o0, o1] = [was.filter.only ?? [], next.filter.only ?? []];
  const n0 = was.filter.not, n1 = next.filter.not;
  // Only narrows each seed, Not everything reached, and a Find term taken out finds less: nothing else is sure to narrow.
  if (!f1.length || !f1.every((t) => has(f0, t)) || !o0.every((t) => has(o1, t))) return null;
  if (n1 === undefined ? n0 !== undefined : !(n0 ?? ['kind system']).every((t) => has(n1, t))) return null;
  const addedOnly = o1.filter((t) => !has(o0, t));
  const addedNot = n1 === undefined ? [] : n1.filter((t) => !has(n0 ?? [], t));
  if (f1.length === f0.length && !addedOnly.length && !addedNot.length) return null;
  // Only's types are one set: another type widens it.
  const isType = (t) => /^type /i.test(t);
  if (addedOnly.some(isType) && o0.some(isType)) return null;
  // Each Find term as the server said it, by its place: the page's own words for them are kept apart.
  const f0Unique = [...new Set(f0.map((t) => t.trim().replace(/\s+/g, ' ')))];
  if (f0Unique.length !== said.find?.length || f0.length !== f0Unique.length) return null;
  const asSaid = new Map(f0.map((t, n) => [t, said.find[n]]));
  const lens = (find) => ({ find, walk: said.walk ?? { over: [], steps: 0 }, limit: said.limit, sessions: said.sessions });
  const { items, links } = answer;
  // The answer held must be the one the query held gives, worked out here: else this page cannot work out another.
  const held = workedOut({ items, links }, lens(said.find));
  const why = (i) => (i.found ? { id: i.id, found: i.found, terms: i.terms } : { id: i.id, step: i.step });
  if (!held || !same(held, items.map(why))) return null;
  // Each Find term is read with the room the terms before it left; one that filled it may have found more than was sent.
  if (!completeReads(items, said.find, said.limit)) return null;
  // Each new term decided of every item it is asked of, or nothing is drawn here.
  let unsure = false;
  const sure = (v) => (v === undefined ? ((unsure = true), false) : v);
  const types = addedOnly.filter(isType);
  const onlyOk = (i) => (!types.length || types.some((t) => sure(holds('only', t, i, ctx)))) && addedOnly.filter((t) => !isType(t)).every((t) => sure(holds('only', t, i, ctx)));
  // A Not said anew holds of everything, what was let through under the one nobody said too.
  const notTerms = n0 === undefined ? (n1 ?? []) : addedNot;
  const notOk = (i) => notTerms.every((t) => !sure(holds('not', t, i, ctx)));
  const out = workedOut({ items, links }, lens(f1.map((t) => asSaid.get(t))), onlyOk, notOk);
  if (unsure || !out) return null;
  const byId = new Map(items.map((i) => [i.id, i]));
  const keptItems = out.map((o) => {
    const { found: _f, terms: _t, step: _s, ...item } = byId.get(o.id);
    return { ...item, ...(o.found ? { found: o.found, terms: o.terms } : { step: o.step }) };
  });
  // Why the frontier found an item is said only while the frontier is in Find.
  if (!f1.some((t) => /^frontier$/i.test(t.trim()))) for (const i of keptItems) delete i.reasons;
  const kept = new Set(out.map((o) => o.id));
  const islandIds = [...new Set(keptItems.flatMap((i) => i.island ?? []))];
  return {
    ...answer,
    lens: { ...said, find: f1.map((t) => asSaid.get(t)), only: o1, ...(n1 !== undefined && { not: n1 }) },
    items: keptItems,
    links: links.filter((l) => kept.has(l.from) && kept.has(l.to)),
    ...(answer.islands && { islands: islandIds.map((id) => answer.islands.find((x) => x.id === id) ?? { id }) }),
  };
}

/** What a drawing is drawn from, said the same way whatever order its fields or links came in: two alike draw alike. */
export function drawnKey(answer) {
  const { lens, matched: _m, pos: _p, whole: _w, ...rest } = answer ?? {};
  const sorted = (v) => (Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v);
  return JSON.stringify(sorted({ ...rest, links: [...(rest.links ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)), from: lens?.from, time: lens?.time }));
}
