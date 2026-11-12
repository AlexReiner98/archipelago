// The model an item's page is drawn by. The map's, or, for an item on an island that runs a version of its pack
// (packs/loader/kernel/island-pin.ts), that version's: its screens, the views it ships of an item and its types' fields, so a person on
// a trial island sees what agents work under there. Asked each time the page draws an item on an island, with the
// same read an agent has (schema, with island); anywhere else the page keeps the map's.

import { api, state } from './base.js';
import { types } from './words.js';

/** The open page's island model: { item, schema, types, version }; null where the page is drawn by the map's. */
let here = null;

/** Ask what an item's island runs and draw its page by it. An island that runs the map's, or a read that fails, leaves the map's. */
export async function readPageModel(e) {
  const island = typeof e.props?.island === 'string' ? e.props.island : undefined;
  const answer = island ? await api('schema', { island }).catch(() => null) : null;
  here = answer?.version ? { item: e.id, schema: answer, types: new Map(answer.types.map((t) => [t.id, t])), version: answer.version } : null;
  return here?.version;
}

/** The model the page is drawn by: the island's version, or the map's. */
export const pageSchema = () => here?.schema ?? state.schema;
/** A type as the page reads it. */
export const pageType = (id) => (here?.types ?? types).get(id);
/** Whether a type is the ancestor or a flavour of it, or declares the capability a has: end names, in the page's model. */
export const pageIsA = (typeId, ancestor) => {
  const all = here?.types ?? types;
  const cap = /^has:(.+)$/.exec(ancestor)?.[1];
  if (cap) return all.get(typeId)?.capabilities?.[cap] !== undefined;
  for (let t = typeId; t; t = all.get(t)?.flavour_of) if (t === ancestor) return true;
  return false;
};
/** The views the open item's version ships, besides the map's: a view opened from its page keeps its settings. */
export const versionCanvases = () => here?.schema.canvases ?? [];
