// What a drawing asks the page to change (`change` in ui/draw-marks.js, which its gestures use): ops as data, which the
// page puts to the person in its own words before anything is sent, and then sends through `change` as theirs
// (decision e_h7he5guk: a drawing asks in data, the page acts as the person). A drawing never writes unseen: a link is
// sent once the person has picked what it says (one of the link types that fit, as an item's Link to… reads them),
// an item once they have named it and, where its island speaks more than one, picked its type. A drawing may ask to
// make one item and to link what is drawn, nothing more; a session that may not write is told so.

import { api, ask, may } from './base.js';
import { fits, isA, kept, relations, typeChoice, types, workType } from './words.js';

const ITEM = /^e_[a-z0-9]{8}$/;

/** The pack an island speaks, by its id. */
const packOf = async (island) => (island ? (await api('get', { id: island }).catch(() => null))?.entity.props?.pack : null);

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

/** The ways one item can be linked to another, each as it reads: from a to b, or from b to a by its inverse. */
const waysBetween = (a, b) =>
  [...relations.values()]
    .filter((r) => !kept(r.id) && !r.retired)
    .flatMap((r) => [
      fits(r.from, a.type) && fits(r.to, b.type) && { type: r.id, from: a.id, to: b.id, said: `${a.title} ${r.title} ${b.title}` },
      fits(r.from, b.type) && fits(r.to, a.type) && r.inverse && r.inverse !== r.title && { type: r.id, from: b.id, to: a.id, said: `${a.title} ${r.inverse} ${b.title}` },
    ])
    .filter(Boolean);

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
    const end = async (key) => made.get(key) ?? (ITEM.test(String(key)) ? (await api('get', { id: key }).catch(() => null))?.entity : null);
    const [a, b] = [await end(o.from), await end(o.to)];
    if (!a || !b || a.id === b.id) return { error: 'A link joins two items that are drawn.' };
    const ways = waysBetween(a, b).filter((w) => !o.type || w.type === o.type);
    if (!ways.length) return { error: `Nothing links ${a.title} and ${b.title}.` };
    const way = await ask({ title: 'Link them', choices: ways.map((w, n) => [n, w.said, w.said]) });
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
