// What a part is handed, worked out from the item and the page (packs/surface/page/part-host.js mounts it): an item cut
// to what the part reads, its piece's settings, a view's params, the style's values, the words it has not saved yet,
// and the items it is offered as the person types or picks on the canvas.

import { api, state } from './base.js';
import { pageType } from './page-schema.js';
import { pickOnCanvas } from './canvas-pick.js';
import { itemOf, waysBetween } from './layout-asks.js';

const NAME = /^[a-z][a-z0-9_]*$/;
/** What of a style a part is handed: its numbers, and its page settings that are words, numbers or yes and no. */
export function styleValues(style) {
  const plain = (o, keep) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => NAME.test(k) && keep(v)));
  return { numbers: plain(style?.numbers, Number.isFinite), page: plain(style?.page, (v) => ['string', 'number', 'boolean'].includes(typeof v)) };
}

/** The types an item is, nearest first: its own and each it is a flavour of. */
export function typesOf(item) {
  const out = [item.type];
  for (let t = pageType(item.type)?.flavour_of; t && !out.includes(t); t = pageType(t)?.flavour_of) out.push(t);
  return [...out, ...(item.is ?? []).filter((t) => !out.includes(t))];
}

/** An item cut to what a part reads of its type: its id and type always, else nothing when it reads none of it. */
/** An item as a part that reads items whole (`*`, a root pack's) is handed it: its head and every field. */
const WHOLE = ['id', 'type', 'title', 'body', 'status', 'is_open', 'visibility', 'private_to', 'owner', 'confidence', 'archived_at', 'created_at', 'updated_at', 'props'];
/** The words with each type's fields and capabilities beside them, for a part that reads items whole. */
export const wholeWords = (words, schema) => ({ ...words, types: Object.fromEntries(Object.entries(words.types).map(([t, w]) => [t, { ...w, ...(schema[t] ?? {}) }])) });

export function cut(item, reads) {
  if (reads === '*') return Object.fromEntries(WHOLE.filter((f) => item[f] !== undefined).map((f) => [f, item[f]]));
  const fields = typesOf(item).map((t) => reads[t]).find(Boolean);
  if (!fields) return null;
  const all = { ...(item.props ?? {}), ...(item.fields ?? {}), ...item };
  return { id: item.id, type: item.type, ...Object.fromEntries(fields.filter((f) => all[f] !== undefined).map((f) => [f, all[f]])) };
}

/** What of a piece's settings on its screen a part is handed: words, numbers, yes and no, and lists of words. */
export function settingsOf(piece) {
  const fit = (v) => ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.length <= 50 && v.every((w) => typeof w === 'string'));
  return Object.fromEntries(Object.entries(piece ?? {}).filter(([k, v]) => NAME.test(k) && k !== 'piece' && fit(v)));
}

/**
 * A view's param filled for where the part stands: `{here}` is the item's id, and a param that is only `{piece.<name>}`
 * is that setting of its piece, list or not. A param that is only one of these, with nothing to fill it, is left out.
 */
export function paramsFor(params, item, piece) {
  const out = {};
  for (const [k, p] of Object.entries(params ?? {})) {
    if (typeof p !== 'string') { out[k] = p; continue; }
    const set = /^\{piece\.([a-z][a-z0-9_]*)\}$/.exec(p)?.[1];
    if (set) { if (piece[set] !== undefined) out[k] = piece[set]; continue; }
    if (p === '{here}' && !item) continue;
    out[k] = p.replaceAll('{here}', item?.id ?? '');
  }
  return out;
}

/** The named reads a part declared, each asked as the person looking, by name: one that fails is handed as null. */
export async function viewsOf(part, item, piece) {
  const views = part.views.filter((v) => !v.live);
  const asked = await Promise.all(views.map((v) => api('view', { name: v.name, params: paramsFor(v.params, item, piece) }).catch(() => null)));
  return Object.fromEntries(views.map((v, i) => [v.name, asked[i] ?? null]));
}

/**
 * Words a part has not saved yet, kept in this browser by part, item and name until it lets them go (tools.keep): a
 * walled worker has no storage of its own. Storage may be blocked or full: then nothing is kept, and the words last as
 * long as the page.
 */
const keptMost = 100000;
// A part on an item keeps by the item; one that stands on none (the tabs, find) by the workspace, so two maps keep apart.
export const keptKey = (part, item, name = '') => `pelago-part:${part.id}:${item?.id ?? `ws.${state.workspace?.id ?? '-'}`}:${name}`;
export function keepFor(part, item, name, value) {
  try {
    const said = value === null || value === undefined ? null : JSON.stringify(value);
    if (said === null || said.length > keptMost) localStorage.removeItem(keptKey(part, item, name));
    else localStorage.setItem(keptKey(part, item, name), said);
  } catch {
    // Not kept: the words are still on the page.
  }
}
export function keptFor(part, item) {
  const out = {};
  try {
    const prefix = keptKey(part, item);
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) out[k.slice(prefix.length)] = JSON.parse(localStorage.getItem(k));
    }
  } catch {
    // Nothing could be kept, so nothing is handed back.
  }
  return out;
}

/** An item as a part is told of it when the person picks it, with the ways it may be linked to `from` when asked. */
const pickedItem = (from, x, link) => {
  const said = { id: x.id, title: x.title, type: x.type };
  if (!link || !from) return said;
  return { ...said, ways: waysBetween(from, x).map((w) => ({ type: w.type, from: w.from, to: w.to, verb: w.verb })) };
};

/** The items an item input offers as the person types: found as they may see them, of the types it names, and, for a link, only those it may be linked to. */
export async function findFor(from, q, types, link) {
  const hits = (await Promise.all((types?.length ? types : [undefined]).map((type) => api('search', { q, ...(type && { type }), limit: 8 }).catch(() => [])))).flat();
  return hits
    .filter((x) => x.id !== from?.id && !String(x.type).startsWith('sys.'))
    .map((x) => pickedItem(from, x, link))
    .filter((x) => !link || x.ways.length)
    .slice(0, 8);
}

/** The item clicked on the canvas for a pick button, as the person may read it; null when let go or unread. */
export async function pickFor(from, kind) {
  const id = await pickOnCanvas(from?.id);
  const other = id && (await itemOf(id));
  return other ? pickedItem(from, other, kind === 'link') : null;
}
