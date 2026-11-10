// Make an island from the page (task e_xfbepbx7): on a map with islands on, a person names it, picks the pack it speaks
// and names the first item on it, which go to the map as one change on their authority. The first item comes with it
// because a picture draws an island round what lives on it: an empty one would stand nowhere to add to.

import { api, ask, may, state, tell } from './base.js';
import { askNew } from './layout-asks.js';

/** Whether this map holds its packs to the island rules (workspace_info islands), read once a page. */
let on;
export const islandsOn = () => (on ??= api('workspace_info').then((info) => info?.islands === true, () => false));

/** The band's menu entry for it, where this session may write on a map with islands. `open` goes to an address. */
export async function newIslandEntry(open) {
  if (!may('write') || !(await islandsOn())) return null;
  return { text: 'New island', title: 'An island of its own: its name, the pack it speaks and its first item', act: () => newIsland(open) };
}

async function newIsland(open) {
  const title = await ask({ title: 'New island', input: { placeholder: 'Its name, a few words' }, action: 'Next' });
  if (!title) return;
  const packs = state.schema?.packs ?? [];
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
    else if (id) open(`#/v?find=${encodeURIComponent(`island ${id}`)}`);
  } catch (err) {
    tell('No island was made', err.message);
  }
}
