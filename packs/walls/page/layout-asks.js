// What a drawing asks the page to change (`change` in packs/walls/page/draw-marks.js, which its gestures use): ops as data, which the
// page puts to the person in its own words before anything is sent, and then sends through `change` as theirs
// (decision e_h7he5guk: a drawing asks in data, the page acts as the person). A drawing never writes unseen: a link is
// sent once the person has picked what it says (one of the link types that fit, as an item's Link to… reads them),
// an item once they have named it and, where its island speaks more than one, picked its type. A drawing may ask to
// make one item and to link what is drawn, nothing more; a session that may not write is told so.

import { api, ask, hooks, may, tell } from './base.js';
import { store } from './live.js';
import { fits, isA, kept, relations, typeChoice, types, workType } from './words.js';

const ITEM = /^e_[a-z0-9]{8}$/;

/**
 * The pack an island speaks, by its id: from a view's answer where one drew it (each island there with its pack), so
 * the person is asked at once; read from the map only for one no view holds (a read can take seconds on a busy server).
 */
async function packOf(island) {
  if (!island) return null;
  for (const view of store.views) {
    const isle = (view.islands ?? []).find((i) => i.id === island);
    if (isle) return isle.pack ?? null;
  }
  return (await api('get', { id: island }).catch(() => null))?.entity.props?.pack ?? null;
}

/** An item by its id, as the page holds it where a view drew it, else as the map has it. */
export const itemOf = async (id) => store.items.get(id) ?? (ITEM.test(String(id)) ? (await api('get', { id }).catch(() => null))?.entity : null);

/** The types an item on an island of this pack may be: the pack's first, then the shared set's, the work type leading. */
function typesOf(pack) {
  const usable = [...types.values()].filter((t) => !t.system && !t.dormant && !t.retired && !t.id.startsWith('sys.') && !isA(t.id, 'system') && !isA(t.id, 'actor'));
  const mine = usable.filter((t) => pack && pack !== 'core' && t.pack === pack);
  const shared = usable.filter((t) => t.pack === 'core').sort((a, b) => Number(b.id === workType()) - Number(a.id === workType()));
  return [...mine, ...shared];
}

/**
 * Ask the person for a new item on an island of this pack: its type, where there is more than one (or `type` when it
 * may be one), and its name. Answers { type, title }, or null when they let it go.
 */
export async function askNew(pack, type) {
  const offered = typesOf(pack);
  const chosen = offered.some((t) => t.id === type) ? type : offered.length > 1 ? await ask({ title: 'Add what?', choices: offered.map((t) => [t.id, typeChoice(t), t.description]) }) : offered[0]?.id;
  if (!chosen) return null;
  const title = await ask({ title: `New ${typeChoice(types.get(chosen)).toLowerCase()}`, input: { placeholder: 'A name, a few words' }, action: 'Add' });
  return title ? { type: chosen, title: title.slice(0, 60) } : null;
}

/** The ways one item can be linked to another, each as it reads (`said`, and `verb` alone): from a to b, or from b to a by its inverse. */
export const waysBetween = (a, b) =>
  [...relations.values()]
    .filter((r) => !kept(r.id) && !r.retired)
    .flatMap((r) => [
      fits(r.from, a.type) && fits(r.to, b.type) && { type: r.id, from: a.id, to: b.id, verb: r.title, said: `${a.title} ${r.title} ${b.title}` },
      fits(r.from, b.type) && fits(r.to, a.type) && r.inverse && r.inverse !== r.title && { type: r.id, from: b.id, to: a.id, verb: r.inverse, said: `${a.title} ${r.inverse} ${b.title}` },
    ])
    .filter(Boolean);

/** Which way a link between a and b reads, put to the person as the verb alone, the two names over it: its index, or null. */
export const askWay = (a, b, ways) => ask({ title: `${a.title.slice(0, 40)} … ${b.title.slice(0, 40)}`, choices: ways.map((w, n) => [n, w.verb, w.said]) });

/** A question put to the person for a drawing: one at a time, so no drawing stacks them. */
let asking = false;

/** Answer what a drawing asked: what came of the change ({ status, created, proposal, held }), or why not ({ error }). */
export async function drawingAsked(said) {
  if (!may('write')) return { error: 'This session may only read the map.' };
  if (asking) return { error: 'The person is answering another change.' };
  asking = true;
  try {
    return await putToPerson(said);
  } finally {
    asking = false;
  }
}

async function putToPerson(said) {
  const ops = Array.isArray(said?.ops) ? said.ops : [];
  const creates = ops.filter((o) => o?.op === 'create'), links = ops.filter((o) => o?.op === 'link');
  if (!ops.length || creates.length > 1 || creates.length + links.length !== ops.length) return { error: 'A drawing may ask to make one item and to link items, nothing else.' };
  const sent = [];
  const made = new Map();
  for (const o of creates) {
    const island = typeof o.props?.island === 'string' && ITEM.test(o.props.island) ? o.props.island : null;
    const asked = await askNew(await packOf(island), o.type);
    if (!asked) return { error: 'Not added.' };
    const ref = typeof o.ref === 'string' && o.ref ? o.ref : 'new';
    made.set(ref, { id: ref, ...asked });
    sent.push({ op: 'create', ref, ...asked, ...(island && { props: { island } }) });
  }
  for (const o of links) {
    const [a, b] = await Promise.all([o.from, o.to].map((key) => made.get(key) ?? itemOf(key)));
    if (!a || !b || a.id === b.id) return { error: 'A link joins two items that are drawn.' };
    const ways = waysBetween(a, b).filter((w) => !o.type || w.type === o.type);
    if (!ways.length) return { error: `Nothing links ${a.title} and ${b.title}.` };
    const way = await askWay(a, b, ways);
    if (way === null) return { error: 'Not linked.' };
    sent.push({ op: 'link', type: ways[way].type, from: ways[way].from, to: ways[way].to });
  }
  try {
    const done = await api('change', { ops: sent, reason: String(said.reason || 'Made on the canvas').slice(0, 300) });
    return { status: done.status, created: done.created ?? {}, ...(done.proposal && { proposal: done.proposal, held: done.held_by?.say ?? '' }) };
  } catch (err) {
    return { error: String(err.message).slice(0, 300) };
  }
}

/**
 * Answer an action or view a drawing asked for (`act`): one its view sends, called as the person looking, naming the
 * view and the drawing's hash so the server checks it is one the view's pack sends (packs/loader/kernel/view-calls.ts).
 * Answers { answer } (with `created` and `changed` when it wrote), or { error }. What the drawing needs said first it names in data
 * (`asks`: each { field, title, input: { placeholder }, choices: [[value, label, hint]], action, danger }), and the
 * page asks it in its own dialog (`ask` in packs/surface/page/base.js), one at a time, before anything is sent: a
 * drawing never hears a key.
 */
export async function drawingActs(said, view, hash) {
  if (typeof view !== 'string' || !view) return { error: 'Only a view a pack ships sends its actions.' };
  const name = String(said?.name ?? '').replaceAll('.', '_');
  const params = said?.params && typeof said.params === 'object' && !Array.isArray(said.params) ? { ...said.params } : {};
  const asks = Array.isArray(said?.asks) ? said.asks.slice(0, 4) : [];
  if (asks.length && asking) return { error: 'The person is answering another question.' };
  asking = asks.length > 0;
  try {
    for (const a of asks) {
      const choices = Array.isArray(a?.choices) ? a.choices.slice(0, 12).map(([v, label, hint]) => [v, String(label ?? v).slice(0, 80), hint && String(hint).slice(0, 200)]) : undefined;
      const got = await ask({ title: String(a?.title ?? 'Go on?').slice(0, 120), ...(a?.message && { message: String(a.message).slice(0, 300) }), ...(a?.input && { input: { placeholder: String(a.input.placeholder ?? '').slice(0, 80) } }), ...(choices && { choices }), action: String(a?.action ?? 'OK').slice(0, 30), danger: a?.danger === true });
      if (got === null || got === '') return { error: 'Not sent.' };
      if (typeof a?.field === 'string' && got !== true) params[a.field] = got;
    }
  } finally {
    asking = false;
  }
  try {
    const came = await api(name, { ...params, part: { view, hash } });
    return { answer: came?.answer ?? came ?? null, ...(came?.created && { created: came.created }), ...((came?.changeset || came?.status) && { changed: true }) };
  } catch (err) {
    return { error: String(err.message).slice(0, 300) };
  }
}

/**
 * Add an item on an island, from the page's own button by its legend: put to the person (its type, its name) and sent
 * as theirs, and kept in sight on the canvas up, its query as it was but for the item (hooks.keepInView, packs/surface/page/canvas.js). A refusal
 * is told.
 */
export async function addOn(island) {
  const came = await drawingAsked({ ops: [{ op: 'create', ref: 'new', props: { island } }], reason: 'Added on the canvas' });
  if (came.error && !/^Not added/.test(came.error)) await tell('Nothing was added', came.error);
  else if (came.proposal) await tell('Held for approval', came.held || 'A rule holds this change for a person to approve before it applies.');
  const id = came.created?.new;
  if (id) await hooks.keepInView?.([{ id, term: `id ${id}` }]);
}
