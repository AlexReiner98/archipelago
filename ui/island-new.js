// Make an island from the page (task e_xfbepbx7): on a map with islands on, a person names it, picks the pack it speaks
// and names the first item on it, which go to the map as one change on their authority. The first item comes with it
// because a picture draws an island round what lives on it: an empty one would stand nowhere to add to.

import { api, ask, h, may, state, tell } from './base.js';
import { keepInView } from './keep-in-view.js';
import { askNew } from './layout-asks.js';

/** Whether this map holds its packs to the island rules (workspace_info islands), read once a page. */
let on;
export const islandsOn = () => (on ??= api('workspace_info').then((info) => info?.islands === true, () => false));

/** The band's button for it, where this session may write on a map with islands. */
export async function newIslandButton() {
  if (!may('write') || !(await islandsOn())) return null;
  return h('button', { type: 'button', class: 'q-save q-word q-island', title: 'A new island: its name, the pack it speaks and its first item', 'aria-label': 'New island', onclick: newIsland }, h('span', { class: 'q-word-text' }, '+ Island'));
}

async function newIsland() {
  const title = await ask({ title: 'New island', input: { placeholder: 'Its name, a few words' }, action: 'Next' });
  if (!title) return;
  // An island speaks an island pack (src/islands.ts); a map pack speaks nothing, so it is never offered. Core when none is.
  const all = state.schema?.packs ?? [];
  const island = all.filter((p) => p.kind === 'island');
  const packs = island.length ? island : all.filter((p) => p.id === 'core');
  const pack = packs.length > 1 ? await ask({ title: `What does ${title.slice(0, 60)} speak?`, choices: packs.map((p) => [p.id, p.title, p.description]) }) : packs[0]?.id;
  if (!pack) return;
  const first = await askNew(pack);
  if (!first) return;
  try {
    const made = await api('change', {
      ops: [
        { op: 'create', ref: 'island', type: 'island', title: title.slice(0, 60), status: 'current', props: { pack } },
        { op: 'create', ref: 'first', ...first, props: { island: '{island}' } },
      ],
      reason: 'An island made on the page',
    });
    const id = made.created?.island;
    if (made.status !== 'applied') await tell('Held for approval', made.held_by?.say ?? 'A rule holds this change for a person to approve before it applies.');
    // The canvas up keeps its query, with the new island added where it would not find it (ui/keep-in-view.js).
    else if (id) await keepInView([{ id: made.created.first, term: `island ${id}` }]);
  } catch (err) {
    tell('No island was made', err.message);
  }
}
