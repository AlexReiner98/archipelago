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
// part may read: the style's numbers and page settings, never a colour or a length, and `up`, the saved view the
// canvas draws now. A part that declares `go` is handed the page's `address` too, again each time it changes
// (addressMoved), and may name another after a gesture (hooks.go checks it). A mark that names a view opens it, and a thumb shows it small, both as the app says
// (hooks.openView, hooks.viewThumb, hooks.viewUp: ui/canvases.js), or as the one drawing the part says (`openView`).

import { api, h, hooks, state } from './base.js';
import { partBridge } from './part-bridge.js';
import { shippedOn, wayBack } from './way-back.js';
import { pageType } from './page-schema.js';
import { endPart, partPort } from './layout.js';
import { MARKS, checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';
import { pickOnCanvas } from './canvas-pick.js';
import { itemOf, waysBetween } from './layout-asks.js';
import { lightItems } from './light-items.js';
import { sessionHue } from './words.js';

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

/**
 * Words a part has not saved yet, kept in this browser by part, item and name until it lets them go (tools.keep): a
 * walled worker has no storage of its own. Storage may be blocked or full: then nothing is kept, and the words last as
 * long as the page.
 */
const keptMost = 100000;
const keptKey = (part, item, name = '') => `pelago-part:${part.id}:${item?.id ?? '-'}:${name}`;
function keepFor(part, item, name, value) {
  try {
    const said = value === null || value === undefined ? null : JSON.stringify(value);
    if (said === null || said.length > keptMost) localStorage.removeItem(keptKey(part, item, name));
    else localStorage.setItem(keptKey(part, item, name), said);
  } catch {
    // Not kept: the words are still on the page.
  }
}
function keptFor(part, item) {
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
async function findFor(from, q, types, link) {
  const hits = (await Promise.all((types?.length ? types : [undefined]).map((type) => api('search', { q, ...(type && { type }), limit: 8 }).catch(() => [])))).flat();
  return hits
    .filter((x) => x.id !== from?.id && !String(x.type).startsWith('sys.'))
    .map((x) => pickedItem(from, x, link))
    .filter((x) => !link || x.ways.length)
    .slice(0, 8);
}

/** The item clicked on the canvas for a pick button, as the person may read it; null when let go or unread. */
async function pickFor(from, kind) {
  const id = await pickOnCanvas(from?.id);
  const other = id && (await itemOf(id));
  return other ? pickedItem(from, other, kind === 'link') : null;
}

/** What a part is handed: the item it stands on, its query's items and its named reads, as the person looking may read them, and its piece's settings. */
async function inputOf(part, item, given) {
  const here = item ? cut(item, part.reads) ?? { id: item.id, type: item.type } : null;
  const views = part.views?.length ? { views: await viewsOf(part, item, given.piece ?? {}) } : {};
  given = { ...given, up: hooks.viewUp?.() ?? null, ...(part.go && { address: hooks.address?.() ?? null }) };
  const kept = keptFor(part, item);
  if (Object.keys(kept).length) given = { ...given, kept };
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
  // A part that declares `go` names another address after a gesture; the app checks it and moves (hooks.go, ui/canvas.js).
  // A part that declares `state` publishes page state; the runtime writes it on the root (publishState).
  one.bridge = partBridge(answering, { partOf: (id) => one.mounted.get(id)?.part, go: (address) => hooks.go?.(address), state: publishState });
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
    } else if (said.type === 'keep') keepFor(m.part, m.item, String(said.name ?? '').slice(0, 80), said.value);
    else if (said.type === 'error') m.failed(said.message);
  };
  return one;
}

/** Which part publishes each name of page state: one name, one owner, and a second part naming it is ignored. */
const publishing = new Map();

/**
 * Page state a part publishes (`state` in its manifest): written on the root as `data-<name>`, where anything watching
 * the page from outside reads it (the picture taken once the canvas has drawn). The part never touches the page: it
 * says a name and a value, and this writes it. Nothing (null) takes the name off.
 */
function publishState(name, value, part) {
  const owner = publishing.get(name);
  if (owner !== undefined && owner !== part.id) return;
  publishing.set(name, part.id);
  if (value === null) delete document.documentElement.dataset[name];
  else document.documentElement.dataset[name] = value;
}

/** The address the page draws has changed: the app says so by name (`hooks.addressMoved`, set below), never by importing this file. */
export function addressMoved() {
  const now = JSON.stringify(hooks.address?.() ?? null);
  for (const one of versions.values()) for (const m of one.mounted.values()) if (m.part.go && m.address !== now) ((m.address = now), void m.refresh());
}
hooks.addressMoved = addressMoved;

/** Take down every part whose place has left the page, and every worker none is drawn by. */
function sweep() {
  for (const [version, one] of versions) {
    for (const [id, m] of one.mounted) if (!m.node.isConnected) (m.render.stop(), one.bridge?.send({ type: 'unmount', id }), one.mounted.delete(id));
    if (one.port && !one.mounted.size) (endPart(version), versions.delete(version));
  }
}

/** Mount one part under `node` on its version's worker, with what it reads; `picture(item, el, input)` draws a picture mark out of what it was handed. */
async function mount(node, part, parts, item, words, piece, { openView, picture } = {}) {
  const version = versionOf(parts, part.pack);
  const one = await workerOf(version, parts, part.pack);
  const id = `m${++mounts}`;
  // A mark that stands for an item opens that item's page when pressed: the host's, so a part names items, never addresses.
  // One that stands for a view opens it, as the app or the one drawing the part says where.
  const opens = (ev) => {
    const at = ev.target.closest?.('[data-view], [data-item]');
    if (!at || !body.contains(at) || at.closest('input, textarea') || (at.closest('button') && !at.dataset.view)) return;
    if (at.dataset.view) return void (openView ?? hooks.openView)?.(at.dataset.view);
    location.hash = `#/e/${at.dataset.item}`;
  };
  const body = h('div', { class: 'part-body', 'data-part-id': part.id, onclick: opens, onkeydown: (ev) => ev.key === 'Enter' && ev.target.dataset?.view && opens(ev) });
  node.replaceChildren(body);
  const failed = (message) => node.isConnected && node.replaceChildren(h('div', { class: 'error', title: String(message) }, `${part.title}: ${String(message).slice(0, 120)}`));
  const style = await styleOn(pinFor(item));
  // What every part is handed beside its items: the island's words, the style's values (none of its looks), and what
  // its piece says of it on its screen (a title, a limit).
  const given = { words, style: styleValues(style), piece: settingsOf(piece) };
  // A picture mark is drawn out of what the part was handed last, never out of what it sent.
  let handed;
  const hand = async () => (handed = await inputOf(part, item, given));
  const render = mountPart(body, {
    style,
    tell: (event) => one.bridge.send({ type: 'event', id, event }),
    thumb: (view) => hooks.viewThumb?.(view) ?? null,
    picture: (at, el) => handed && picture?.(at, el, handed),
    find: (q, types, link) => findFor(item, q, types, link),
    pick: (kind) => pickFor(item, kind),
    // What a mark lights while the person points at it: those items lit on the canvas in sight, the rest faded.
    lights: (ids) => lightItems(hooks.viewUp?.() ?? null, ids?.length ? ids : null),
    // A pane's canvas, drawn at its address by whoever keeps the panes (hooks.paneFrame), told back what is done in it.
    frame: (at, el, said) => hooks.paneFrame?.(at, el, said) ?? null,
    // A session's hue, named by its words, as every session is marked.
    hue: (words) => sessionHue(words),
  });
  const refresh = async () => node.isConnected && one.mounted.has(id) && one.bridge.send({ type: 'update', id, input: await hand() });
  // The bridge sends the island with the part, so the server checks the part's code where it is drawn.
  one.mounted.set(id, { part: { ...part, island: pinFor(item) }, item, node, render, failed, refresh, address: JSON.stringify(hooks.address?.() ?? null) });
  one.bridge.send({ type: 'mount', id, part: part.id, input: await hand() });
}

/** The island an item is on: its own id when it is one (its type has the field an island pins a version by), else its island. */
function islandOf(item) {
  if (!item) return undefined;
  return pageType(item.type)?.fields?.pack_version ? item.id : (item.props?.island ?? item.island ?? undefined);
}

/**
 * Which pinned version of a part is mounted and fetched, given what the part stands on: the island of the item, where
 * it stands on one. A part that stands on nothing (the tabs, the panes, Home, the menu, a bar over a canvas that spans
 * islands) is the chrome, and is to be pinned per person (decision e_x6bqupud, task e_fpm9n7er); until that lands the
 * chrome runs the map's version, which is what `undefined` asks for here. Every place that resolves a version goes
 * through this one function, so that change is one function's.
 */
function pinFor(item) {
  return islandOf(item);
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
 * caller draws what it did before). `piece` is what its screen says of it; `redraw` draws the page again when the way back is pressed;
 * `openView(view)` opens a view a mark names (else hooks.openView); `picture(item, el, input)` draws a picture mark's
 * item out of the input the part was handed.
 */
export async function drawPart(node, { slot, item, piece, redraw = () => {}, openView, picture }) {
  sweep();
  const island = pinFor(item);
  const shipped = Boolean(island && shippedOn(island));
  const { parts, refined, words } = await partsOn(island, shipped);
  wayBackFor(island, shipped ? undefined : refined, async () => redraw());
  const part = parts.find((p) => p.slot === slot);
  if (!part) return false;
  // A part naming a mark this host does not draw waits: said in one line, its code never sent or run.
  if (part.waiting) return (node.replaceChildren(h('div', { class: 'muted', title: `${part.title} waits: ${part.waiting}` }, `${part.title} waits`)), true);
  if (!part.modules) throw new Error(`${part.title}: its code did not come`);
  await mount(node, part, parts, item, words, piece, { openView, picture });
  return true;
}

/**
 * Draw every part that fills `slot`, each in a node of its own under `node`, and answer how many: a slot a page holds
 * several of (a card on the workspace page, a mark on a tab). The page draws what it has itself and asks for this
 * beside it, so a slot no pack fills yet simply adds nothing. Takes what `drawPart` takes.
 */
export async function drawParts(node, { slot, item, piece, redraw = () => {}, openView, picture }) {
  sweep();
  const island = pinFor(item);
  const shipped = Boolean(island && shippedOn(island));
  const { parts, refined, words } = await partsOn(island, shipped);
  wayBackFor(island, shipped ? undefined : refined, async () => redraw());
  const filling = parts.filter((p) => p.slot === slot);
  for (const part of filling) {
    // Its name on the node, so a step that names a card (#/workspace?at=agent) brings this part into view.
    const mine = h('div', { class: 'part-in', 'data-at': part.id.split('.').slice(1).join('.') || part.id });
    node.append(mine);
    if (part.waiting) mine.replaceChildren(h('div', { class: 'muted', title: `${part.title} waits: ${part.waiting}` }, `${part.title} waits`));
    else if (!part.modules) mine.replaceChildren(h('div', { class: 'muted' }, `${part.title}: its code did not come`));
    else await mount(mine, part, parts, item, words, piece, { openView, picture });
  }
  return filling.length;
}
