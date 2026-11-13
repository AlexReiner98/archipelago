// The islands pack's handler, run in its own sandboxed process by the kernel's pack host. Its one action, islands.make,
// makes an island from the page (task e_xfbepbx7): its name, the island pack it speaks and its first item, as one
// change. The first item comes with it because a picture draws an island round what lives on it: an empty one would
// stand nowhere to add to. Whether the change applies or waits is the rules' to say; an island's pack is fixed once it
// is made (packs/loader/kernel/island-items.ts).

/** How long a name may be: a name is a few words. */
export const TITLE_MOST = 60;

const PACK = /^[a-z][a-z0-9_]*$/;
const TYPE = /^[a-z][a-z0-9_.]*$/;

/** The ops that make an island speaking `pack` with its first item, or why they cannot. */
export function makeIsland(input) {
  const title = String(input?.title ?? '').trim();
  const pack = String(input?.pack ?? '');
  const first = input?.first ?? {};
  const named = String(first.title ?? '').trim();
  if (!title) throw new Error('An island needs a name.');
  if (!PACK.test(pack)) throw new Error('An island speaks a pack: name one.');
  if (typeof first.type !== 'string' || !TYPE.test(first.type)) throw new Error('Its first item needs a type.');
  if (!named) throw new Error('Its first item needs a name.');
  return {
    ops: [
      { op: 'create', ref: 'island', type: 'island', title: title.slice(0, TITLE_MOST), status: 'current', props: { pack } },
      { op: 'create', ref: 'first', type: first.type, title: named.slice(0, TITLE_MOST), props: { island: '{island}' } },
    ],
    reason: 'An island made on the page',
    answer: { title: title.slice(0, TITLE_MOST), pack },
  };
}

export default {
  'islands.make': async (input) => makeIsland(input),
};
