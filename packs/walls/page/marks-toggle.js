// The page's half of a pack's mark in an island's header (feature e_knepxwmn; the drawing's half is
// packs/canvas/layouts/flow/pack-marks.js): a mark that asks for `toggle`, standing for an island by its `item` and for
// a pack by its `pack`, is a button the page answers itself, as the island's add row is (./marks-add.js). A click turns
// that pack off or on for that island alone (decision e_cagr6ssp): an update of the island's list of packs turned off,
// sent through `change` as the person's. Turning off a pack that would send items waiting is put to them first. A part
// of a pack (feature e_4r82mvf3), a mark keyed `pt:`, naming the part by its `pack`, is turned off or on the same way, in
// the island's list of parts turned off.

import { api, ask, hooks, may, tell } from './base.js';
import { itemOf } from './layout-asks.js';

/** The field on an island's focus item that lists the packs turned off there (the kernel half, packs/surface/kernel/packreads-flat.ts). */
export const PACKS_OFF = 'packs_off';
/** The field on an island's focus item that lists the parts of packs turned off there (packs/loader/kernel/island-parts.ts). */
export const PARTS_OFF = 'parts_off';

/** The pack as a view's answer gives it on that island: its own or one it requires, with its state and what turning it off sends waiting. */
function declared(island, pack) {
  for (const view of hooks.store?.()?.views ?? []) {
    const own = (view.islands ?? []).find((i) => i.id === island)?.pack;
    if (!own) continue;
    return own.id === pack ? own : (own.requires ?? []).find((r) => r.id === pack) ?? null;
  }
  return null;
}

/** The packs (or parts) turned off on an island, as its item says. */
const offOn = (item, field = PACKS_OFF) => {
  const v = item?.fields?.[field] ?? item?.props?.[field];
  return Array.isArray(v) ? v.filter((p) => typeof p === 'string') : [];
};

/** Turn `pack` off on `island` where it is on there, else on: put to the person where items would wait, sent as theirs. */
export async function togglePack(island, pack) {
  if (!may('write')) return tell('Nothing was changed', 'This session may only read the map.');
  const item = await itemOf(island), off = offOn(item), turningOff = !off.includes(pack);
  const p = declared(island, pack), name = p?.title ?? pack, n = Number.isInteger(p?.off_would_wait) ? p.off_would_wait : 0;
  if (turningOff && n > 0) {
    const go = await ask({ title: `Turn ${name} off here?`, message: `${n} item${n === 1 ? '' : 's'} on ${item?.title ?? 'this island'} would wait until it is on again.`, action: 'Turn off' });
    if (!go) return;
  }
  const next = turningOff ? [...off, pack] : off.filter((x) => x !== pack);
  await send(island, PACKS_OFF, next, `${turningOff ? 'Turned' : 'Turned back'} ${name} ${turningOff ? 'off' : 'on'} on this island`);
}

/** Update an island's list of what is off, through `change` as the person's: held, they are told so. */
async function send(island, field, next, reason) {
  try {
    const done = await api('change', { ops: [{ op: 'update', id: island, props: { [field]: next } }], reason });
    if (done?.proposal) await tell('Held for approval', done.held_by?.say || 'A rule holds this change for a person to approve before it applies.');
  } catch (err) {
    await tell('Nothing was changed', String(err.message).slice(0, 300));
  }
}

/** Turn a pack's `part` off on `island` where it is on there, else on: sent as the person's. What it sends waiting shows on the island. */
export async function togglePart(island, part) {
  if (!may('write')) return tell('Nothing was changed', 'This session may only read the map.');
  const item = await itemOf(island), off = offOn(item, PARTS_OFF), turningOff = !off.includes(part);
  const next = turningOff ? [...off, part] : off.filter((x) => x !== part);
  await send(island, PARTS_OFF, next, `${turningOff ? 'Turned' : 'Turned back'} ${part} ${turningOff ? 'off' : 'on'} on this island`);
}

/** Make `el` a button that turns its pack off or on for its island: its part, where its `key` is a part's (`pt:`). */
export function togglable(el, key = '') {
  el.setAttribute('role', 'button');
  el.setAttribute('tabindex', '0');
  const go = async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const { item, pack } = el.dataset;
    if (item && pack) await (String(key).startsWith('pt:') ? togglePart : togglePack)(item, pack);
  };
  el.addEventListener('click', go);
  el.addEventListener('keydown', (ev) => (ev.key === 'Enter' || ev.key === ' ') && go(ev));
  // Neither the plane's pan nor a click through to the island's page starts from it.
  el.addEventListener('pointerdown', (ev) => ev.stopPropagation());
}
