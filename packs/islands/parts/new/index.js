// Make an island from the band, as the islands pack's part (task e_pe3fjd75, from ui/island-new.js): a person names
// it, picks the island pack it speaks and names its first item, in the band, and it goes to the map as one change on
// their authority (islands.make). Then what was made stays in sight: the canvas keeps its query, with the new island
// added as a term (`island <id>`), as a click adds to the filter (the owner, 10 Nov 2026).
//
// Its piece says what it may offer, as the host reads the schema: the island packs (`packs`, their names in `names`),
// and the types a first item may be (`types`, each "<pack> <type>", core's shared by every island, their names in `type_names`). With no
// packs (the map has no islands, or this session may only read) it draws nothing.

const cut = (s, n = 200) => String(s ?? '').slice(0, n);
const words = (v) => (Array.isArray(v) ? v.map(String) : []);

/** The island packs offered, each { id, title }, and the types each offers, each { pack, id, title }. */
export function offered(piece) {
  const ids = words(piece?.packs), names = words(piece?.names);
  const packs = ids.map((id, i) => ({ id, title: names[i] ?? id }));
  const typeNames = words(piece?.type_names);
  const types = words(piece?.types).map((t, i) => {
    const [pack, id] = t.split(' ');
    return { pack, id, title: typeNames[i] ?? id };
  }).filter((t) => t.pack && t.id);
  return { packs, types };
}

/** The types an item on an island of `pack` may be: the pack's own first, then the shared set's (core's). */
export const startsWith = (types, pack) => [...types.filter((t) => t.pack === pack && pack !== 'core'), ...types.filter((t) => t.pack === 'core')];

/** The query up with the island added as a term, unless it already names it. */
export function withIsland(query, id) {
  const term = `island ${id}`;
  const find = Array.isArray(query?.filter?.find) ? query.filter.find : [];
  if (find.includes(term)) return query;
  return { ...query, filter: { ...(query?.filter ?? {}), find: [...find, term] } };
}

function marks(input, at) {
  const { packs, types } = offered(input?.piece);
  if (!packs.length) return ['box', {}];
  if (!at.open) return ['button', { key: 'island', look: 'quiet', tip: 'A new island: its name, the pack it speaks and its first item' }, '+ Island'];
  const pack = at.pack || packs[0].id;
  const its = startsWith(types, pack);
  const type = its.some((t) => t.id === at.type) ? at.type : its[0]?.id;
  return ['box', { flow: 'row', gap: 3, align: 'center', wrap: true },
    ['input', { key: 'name', value: at.name, hint: 'Its name, a few words', label: 'The island’s name', focus: true }],
    ...(packs.length > 1 ? [['input', { key: 'pack', kind: 'pick', value: pack, values: packs.map((p) => p.id), names: packs.map((p) => p.title), label: 'What it speaks', tip: 'The island pack it speaks: fixed once it is made' }]] : []),
    ...(its.length > 1 ? [['input', { key: 'type', kind: 'pick', value: type, values: its.map((t) => t.id), names: its.map((t) => t.title), label: 'Its first item', tip: 'What its first item is: an island is drawn round what lives on it' }]] : []),
    ['input', { key: 'first', value: at.first, hint: 'Its first item, a few words', label: 'Its first item’s name' }],
    at.going ? ['text', { look: 'muted' }, 'Making…'] : ['button', { key: 'make', look: 'main', tip: 'Make the island with its first item' }, 'Make'],
    ['button', { key: 'cancel', look: 'quiet', tip: 'Make nothing' }, 'Cancel'],
    ...(at.said ? [['text', { tone: 'bad', size: 2, tip: cut(at.said) }, cut(at.said, 80)]] : []),
  ];
}

export default function islandNew(input, tools) {
  let now = input;
  const at = { open: false, name: '', pack: '', type: '', first: '', going: false, said: '' };
  const draw = () => marks(now, at);
  const shut = () => Object.assign(at, { open: false, name: '', pack: '', type: '', first: '', said: '' });

  async function make() {
    const { packs, types } = offered(now?.piece);
    const pack = at.pack || packs[0]?.id;
    const its = startsWith(types, pack);
    const type = its.some((t) => t.id === at.type) ? at.type : its[0]?.id;
    if (!at.name.trim()) return ((at.said = 'An island needs a name.'), draw());
    if (!type) return ((at.said = 'That pack offers nothing to start an island with.'), draw());
    if (!at.first.trim()) return ((at.said = 'Its first item needs a name.'), draw());
    at.going = true;
    at.said = '';
    tools.marks(draw());
    const made = await tools.act('islands.make', { title: at.name.trim().slice(0, 60), pack, first: { type, title: at.first.trim().slice(0, 60) } });
    at.going = false;
    if (made?.error) return ((at.said = String(made.error)), draw());
    const island = made?.created?.island;
    shut();
    if (made?.proposal) return ((at.said = 'Held for the owner'), draw());
    // What was made stays in sight: the query up, with the island added where it names none.
    if (island && now?.address?.query) tools.go({ query: withIsland(now.address.query, island), layout: now.address.layout ?? {} });
    return draw();
  }

  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    async on(event) {
      if (at.going || !event) return undefined;
      if (['name', 'first'].includes(event.key) && (event.name === 'edit' || event.name === 'submit')) {
        at[event.key] = cut(event.value, 200);
        return event.name === 'submit' ? make() : undefined;
      }
      if (['pack', 'type'].includes(event.key) && event.name === 'pick') return ((at[event.key] = cut(event.value, 80)), draw());
      if (event.name !== 'press') return undefined;
      if (event.key === 'island') return ((at.open = true), draw());
      if (event.key === 'cancel') return (shut(), draw());
      if (event.key === 'make') return make();
      return undefined;
    },
  };
}
