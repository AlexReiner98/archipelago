// The host of the page's parts (task e_unrwyyzh, decision e_fxayrhma): where a slot is filled by a pack's part, this
// draws it. It asks which parts the island draws (the view `parts`, the loader root's root.parts), starts each pack
// version's worker in the walled frame (partPort, packs/walls/page/layout.js), hands a part the item it stands on and
// the items of its query, each cut to the fields it reads, checks every answer (packs/walls/page/part-check.js) and
// draws it (packs/walls/page/part-render.js), sends what the person does back, and sends a part's actions through the
// bridge (./part-bridge.js), a change it sends on its own shown as it goes (./part-going.js). Where the island draws
// anything but the shipped parts, the way back (./way-back.js) stands at the page's foot, out of every part's reach.
//
// A part is handed nothing it did not declare: of an item, its id and type and the fields it reads of that type; its
// query is asked as the person looking, so what they may not see it never gets.

import { api, h, state } from './base.js';
import { partBridge } from './part-bridge.js';
import { shippedOn, wayBack } from './way-back.js';
import { pageType } from './page-schema.js';
import { endPart, partPort } from './layout.js';
import { checkMarks } from './part-check.js';
import { mountPart } from './part-render.js';

/** Each part's modules by the hash of them, once fetched: asked again, the page says it has them. */
const modules = new Map();
/** The workers started, by version: the port, its bridge, and the parts mounted on it by mount id. */
const versions = new Map();
let mounts = 0;
/** The way back drawn now, and the island it is for. */
let back;

/** The parts an island draws (or the map, with no island), or as they ship; each with its modules. */
async function partsOn(island, shipped) {
  const answer = await api('view', { name: 'parts', params: { ...(island && { island }), have: [...modules.keys()], ...(shipped && { shipped: true }) } });
  const parts = (answer?.parts ?? []).map((p) => (p.modules && modules.set(p.hash, p.modules), { ...p, modules: modules.get(p.hash) }));
  return { parts, refined: answer?.refined };
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

/** What a part is handed: the item it stands on, and its query's items, as the person looking may read them. */
async function inputOf(part, item) {
  const here = item ? cut(item, part.reads) ?? { id: item.id, type: item.type } : null;
  if (!part.query) return { item: here };
  const fill = (terms) => terms?.map((t) => t.replaceAll('{here}', item?.id ?? ''));
  const filter = { find: fill(part.query.find), ...(part.query.only && { only: fill(part.query.only) }), ...(part.query.not && { not: fill(part.query.not) }) };
  const answer = await api('view', { name: 'flat', params: { filter, limit: part.query.limit ?? 50 } });
  return { item: here, items: (answer?.items ?? []).map((i) => cut(i, part.reads)).filter(Boolean), ...(answer?.cut && { more: true }) };
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
        m.render.draw(checkMarks(said.marks));
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
async function mount(node, part, parts, item) {
  const version = versionOf(parts, part.pack);
  const one = await workerOf(version, parts, part.pack);
  const id = `m${++mounts}`;
  const body = h('div', { class: 'part-body', 'data-part-id': part.id });
  node.replaceChildren(body);
  const failed = (message) => node.isConnected && node.replaceChildren(h('div', { class: 'error', title: String(message) }, `${part.title}: ${String(message).slice(0, 120)}`));
  const render = mountPart(body, { style: state.style, tell: (event) => one.bridge.send({ type: 'event', id, event }) });
  const refresh = async () => node.isConnected && one.mounted.has(id) && one.bridge.send({ type: 'update', id, input: await inputOf(part, item) });
  one.mounted.set(id, { part, node, render, failed, refresh });
  one.bridge.send({ type: 'mount', id, part: part.id, input: await inputOf(part, item) });
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
 * caller draws what it did before). `redraw` draws the page again when the way back is pressed.
 */
export async function drawPart(node, { slot, item, redraw = () => {} }) {
  sweep();
  const island = islandOf(item);
  const shipped = Boolean(island && shippedOn(island));
  const { parts, refined } = await partsOn(island, shipped);
  wayBackFor(island, shipped ? undefined : refined, async () => redraw());
  const part = parts.find((p) => p.slot === slot);
  if (!part) return false;
  if (!part.modules) throw new Error(`${part.title}: its code did not come`);
  await mount(node, part, parts, item);
  return true;
}
