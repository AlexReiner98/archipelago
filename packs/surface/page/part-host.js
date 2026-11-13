// The host of the page's parts (task e_unrwyyzh, decision e_fxayrhma): where a slot is filled by a pack's part, this
// draws it. It asks which parts the island draws (the view `parts`, the loader root's root.parts), starts each pack
// version's worker in the walled frame (partPort, packs/walls/page/layout.js), hands a part the item it stands on and
// the items of its query, each cut to the fields it reads, and the named reads it declares (views), checks every answer (packs/walls/page/part-check.js) and
// draws it (packs/walls/page/part-render.js), sends what the person does back, and sends a part's actions through the
// bridge (./part-bridge.js), a change it sends on its own shown as it goes (./part-going.js). Where the island draws
// anything but the shipped parts, the way back (./way-back.js) stands at the page's foot, out of every part's reach.
//
// A part is handed nothing it did not declare: of an item, its id and type and the fields it reads of that type; its
// query is asked as the person looking, so what they may not see it never gets. Beside them every part is handed, as
// data (decision e_fx62gsjb), the schema's `words` of the island it draws for (root.parts) and the `style` values a
// part may read: the style's numbers and page settings, never a colour or a length.

import { api, h, state } from './base.js';
import { partBridge } from './part-bridge.js';
import { shippedOn, wayBack } from './way-back.js';
import { pageType } from './page-schema.js';
import { endPart, partPort } from './layout.js';
import { MARKS, checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';

/** Each part's modules by the hash of them, once fetched: asked again, the page says it has them. */
const modules = new Map();
/** The workers started, by version: the port, its bridge, and the parts mounted on it by mount id. */
const versions = new Map();
let mounts = 0;
/** The schema's words by their hash, once read: asked again, the page says it has them. */
const wordsBy = new Map();
/** Each island's style (the map's, under ''), once read. */
const styles = new Map();
/** The way back drawn now, and the island it is for. */
let back;

/** The commit of the host this page loaded with (the server's, as it served these files): named on what the page draws and sends. */
const host = fetch('/health').then((r) => r.json()).then((x) => (typeof x?.commit === 'string' ? x.commit : undefined), () => undefined);
/** A look redrawn as it was asks its parts at a past position of the log (`?at=`, packs/look_draw/kernel/looks.ts). */
const at = (() => { const n = Number(new URLSearchParams(location.search).get('at')); return Number.isInteger(n) && n > 0 ? n : undefined; })();
/** What the page drew with, as the server recorded it, by island ('' the map): what a look keeps beside its picture. */
const drew = new Map();
window.lookDrew = () => [...drew.values()];

/** The parts an island draws (or the map, with no island), or as they ship; each with its modules. */
async function partsOn(island, shipped) {
  const loaded = await host;
  const answer = await api('view', { name: 'parts', params: { ...(island && { island }), have: [...modules.keys(), ...wordsBy.keys()], marks: Object.keys(MARKS), ...(shipped && { shipped: true }), ...(loaded && { host: loaded }), ...(at && { at }) } });
  if (answer?.drew) drew.set(island ?? '', answer.drew);
  const parts = (answer?.parts ?? []).map((p) => (p.modules && modules.set(p.hash, p.modules), { ...p, modules: modules.get(p.hash), ...(loaded && { host: loaded }) }));
  if (answer?.words?.types) wordsBy.set(answer.words.hash, { types: answer.words.types, links: answer.words.links });
  return { parts, refined: answer?.refined, words: wordsBy.get(answer?.words?.hash) ?? { types: {}, links: {} } };
}

/** The style a part on `island` is drawn by: the island's own, as its page is; the map's where there is none. */
async function styleOn(island) {
  const at = island ?? '';
  if (!styles.has(at)) styles.set(at, island ? api('view', { name: 'style', params: { of: island } }).then((r) => r?.style ?? state.style, () => state.style) : Promise.resolve(state.style));
  return styles.get(at);
}

const NAME = /^[a-z][a-z0-9_]*$/;
/** What of a style a part is handed: its numbers, and its page settings that are words, numbers or yes and no. */
function styleValues(style) {
  const plain = (o, keep) => Object.fromEntries(Object.entries(o && typeof o === 'object' ? o : {}).filter(([k, v]) => NAME.test(k) && keep(v)));
  return { numbers: plain(style?.numbers, Number.isFinite), page: plain(style?.page, (v) => ['string', 'number', 'boolean'].includes(typeof v)) };
}

/** A pack version's name for its worker: the pack and the hashes of its parts, so new code is a new worker. */
const versionOf = (parts, pack) => `${pack}:${parts.filter((p) => p.pack === pack).map((p) => p.hash.slice(0, 12)).join('.')}`;

/** The types an item is, nearest first: its own and each it is a flavour of. */
function typesOf(item) {
  const out = [item.type];
  for (let t = pageType(item.type)?.flavour_of; t && !out.includes(t); t = pageType(t)?.flavour_of) out.push(t);
  return [...out, ...(item.is ?? []).filter((t) => !out.includes(t))];
}

/** An item cut to what a part reads of its type: its id and type always, else nothing when it reads none of it. */
function cut(item, reads) {
  const fields = typesOf(item).map((t) => reads[t]).find(Boolean);
  if (!fields) return null;
  const all = { ...(item.props ?? {}), ...(item.fields ?? {}), ...item };
  return { id: item.id, type: item.type, ...Object.fromEntries(fields.filter((f) => all[f] !== undefined).map((f) => [f, all[f]])) };
}

/** What of a piece's settings on its screen a part is handed: words, numbers, yes and no, and lists of words. */
function settingsOf(piece) {
  const fit = (v) => ['string', 'number', 'boolean'].includes(typeof v) || (Array.isArray(v) && v.length <= 50 && v.every((w) => typeof w === 'string'));
  return Object.fromEntries(Object.entries(piece ?? {}).filter(([k, v]) => NAME.test(k) && k !== 'piece' && fit(v)));
}

/**
 * A view's param filled for where the part stands: `{here}` is the item's id, and a param that is only `{piece.<name>}`
 * is that setting of its piece, list or not. A param that is only one of these, with nothing to fill it, is left out.
 */
function paramsFor(params, item, piece) {
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
async function viewsOf(part, item, piece) {
  const asked = await Promise.all(part.views.map((v) => api('view', { name: v.name, params: paramsFor(v.params, item, piece) }).catch(() => null)));
  return Object.fromEntries(part.views.map((v, i) => [v.name, asked[i] ?? null]));
}

/** What a part is handed: the item it stands on, its query's items and its named reads, as the person looking may read them, and its piece's settings. */
async function inputOf(part, item, given) {
  const here = item ? cut(item, part.reads) ?? { id: item.id, type: item.type } : null;
  const views = part.views?.length ? { views: await viewsOf(part, item, given.piece ?? {}) } : {};
  if (!part.query) return { item: here, ...views, ...given };
  const fill = (terms) => terms?.map((t) => t.replaceAll('{here}', item?.id ?? ''));
  const filter = { find: fill(part.query.find), ...(part.query.only && { only: fill(part.query.only) }), ...(part.query.not && { not: fill(part.query.not) }) };
  const answer = await api('view', { name: 'flat', params: { filter, limit: part.query.limit ?? 50 } });
  return { item: here, items: (answer?.items ?? []).map((i) => cut(i, part.reads)).filter(Boolean), ...(answer?.cut && { more: true }), ...views, ...given };
}

/** A version's worker, started once: its port heard here, each message going to the part mounted under its id. */
async function workerOf(version, parts, pack) {
  if (versions.get(version)) return versions.get(version);
  const mine = parts.filter((p) => p.pack === pack);
  const one = { mounted: new Map() };
  versions.set(version, one);
  const stopped = (said) => {
    for (const m of one.mounted.values()) m.failed(said?.message ?? 'The pack stopped.');
    versions.delete(version);
  };
  try {
    one.port = await partPort(version, Object.fromEntries(mine.map((p) => [p.id, p.modules])), stopped);
  } catch (err) {
    versions.delete(version);
    throw err;
  }
  // Once an action a part sent has gone out, its version's parts are handed their items again: what it changed is
  // then what they read. The bridge answers on this port, so its answer is where that is known.
  const port = one.port;
  const answering = {
    postMessage(message) {
      port.postMessage(message);
      if (message?.type === 'acted' && !message.error) for (const m of one.mounted.values()) void m.refresh();
    },
  };
  one.bridge = partBridge(answering, { partOf: (id) => one.mounted.get(id)?.part });
  one.port.onmessage = (ev) => {
    const said = ev.data ?? {};
    if (one.bridge.heard(said)) return;
    const m = one.mounted.get(String(said.id));
    if (!m) return;
    if (said.type === 'marks') {
      try {
        m.render.draw(checkMarks(said.marks, { kinds: m.part.marks }));
      } catch (err) {
        m.failed(err.message);
      }
    } else if (said.type === 'error') m.failed(said.message);
  };
  return one;
}

/** Take down every part whose place has left the page, and every worker none is drawn by. */
function sweep() {
  for (const [version, one] of versions) {
    for (const [id, m] of one.mounted) if (!m.node.isConnected) (m.render.stop(), one.bridge?.send({ type: 'unmount', id }), one.mounted.delete(id));
    if (one.port && !one.mounted.size) (endPart(version), versions.delete(version));
  }
}

/** Mount one part under `node` on its version's worker, with what it reads. */
async function mount(node, part, parts, item, words, piece) {
  const version = versionOf(parts, part.pack);
  const one = await workerOf(version, parts, part.pack);
  const id = `m${++mounts}`;
  // A mark that stands for an item opens that item's page when pressed: the host's, so a part names items, never addresses.
  const body = h('div', { class: 'part-body', 'data-part-id': part.id, onclick: (ev) => { const el = ev.target.closest?.('[data-item]'); if (el && body.contains(el) && !el.closest('button, input, textarea')) location.hash = `#/e/${el.dataset.item}`; } });
  node.replaceChildren(body);
  const failed = (message) => node.isConnected && node.replaceChildren(h('div', { class: 'error', title: String(message) }, `${part.title}: ${String(message).slice(0, 120)}`));
  const style = await styleOn(islandOf(item));
  // What every part is handed beside its items: the island's words, the style's values (none of its looks), and what
  // its piece says of it on its screen (a title, a limit).
  const given = { words, style: styleValues(style), piece: settingsOf(piece) };
  const render = mountPart(body, { style, tell: (event) => one.bridge.send({ type: 'event', id, event }) });
  const refresh = async () => node.isConnected && one.mounted.has(id) && one.bridge.send({ type: 'update', id, input: await inputOf(part, item, given) });
  // The bridge sends the island with the part, so the server checks the part's code where it is drawn.
  one.mounted.set(id, { part: { ...part, island: islandOf(item) }, node, render, failed, refresh });
  one.bridge.send({ type: 'mount', id, part: part.id, input: await inputOf(part, item, given) });
}

/** The island an item is on: its own id when it is one (its type has the field an island pins a version by), else its island. */
function islandOf(item) {
  if (!item) return undefined;
  return pageType(item.type)?.fields?.pack_version ? item.id : (item.props?.island ?? item.island ?? undefined);
}

/** Show the way back for an island while it draws anything but the shipped parts, and take down another island's. */
function wayBackFor(island, refined, redraw) {
  if (back?.island !== island) (back?.press.stop(), (back = undefined));
  if (!island) return;
  if (back) return back.press.update(refined);
  back = { island, press: wayBack({ island, refined, redraw }) };
}

/**
 * Draw the part that fills `slot` in `node`, standing on `item`: true when a part fills it, false when none does (the
 * caller draws what it did before). `piece` is what its screen says of it; `redraw` draws the page again when the way back is pressed.
 */
export async function drawPart(node, { slot, item, piece, redraw = () => {} }) {
  sweep();
  const island = islandOf(item);
  const shipped = Boolean(island && shippedOn(island));
  const { parts, refined, words } = await partsOn(island, shipped);
  wayBackFor(island, shipped ? undefined : refined, async () => redraw());
  const part = parts.find((p) => p.slot === slot);
  if (!part) return false;
  // A part naming a mark this host does not draw waits: said in one line, its code never sent or run.
  if (part.waiting) return (node.replaceChildren(h('div', { class: 'muted', title: `${part.title} waits: ${part.waiting}` }, `${part.title} waits`)), true);
  if (!part.modules) throw new Error(`${part.title}: its code did not come`);
  await mount(node, part, parts, item, words, piece);
  return true;
}
