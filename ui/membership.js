// ---- what a view's query reads, and whether a fact may change what it finds -----------------------------------
//
// The page's one store (ui/replica.js) brings every fact to the items it holds, but which items a view shows is the
// server's to judge (the owner, 5 Nov 2026, e_5cdm9bfg): the page never runs a query itself. What it does know is
// what a query reads: the fields its terms name, the links it walks, the items it is anchored on, the islands it
// looks at. A fact that touches one of those may change the answer, and the view asks the server for it again; any
// other fact only changes what the view draws of the items it already holds. Pure: a lens and facts in, a yes or no out
// (test/replica.test.ts).

const ID = /e_[a-z0-9]{8}/g;
/** Only's words (src/query-only.ts) and the fields each reads; `*` for one that reads beyond its item's row. */
const WORDS = [
  [/^done$/i, ['status']],
  [/^status\s/i, ['status']],
  [/^by (owner|agent)$/i, ['status']],
  [/^no owner$/i, ['owner']],
  [/^made (since|before)\s/i, []],
  [/^(blocked|over estimate)$/i, '*'],
  [/^changed (since|before)\s/i, '*'],
];

/**
 * What a lens reads, from its terms as written (src/query-terms.ts): `fields` its terms name (`*`: any), `links` it
 * walks or names (`*`: any), `anchors` the items it names, `islands` the islands it names, and whether a new item
 * anywhere may be found by it (`unanchored`: a type, a kind, a text or an island term in Find).
 */
export function reads(lens) {
  const out = { fields: new Set(), links: new Set(), anchors: new Set(), islands: new Set(), unanchored: false, all: false };
  const field = (...f) => (f[0] === '*' ? (out.fields = '*') : out.fields !== '*' && f.forEach((x) => out.fields.add(x)));
  const link = (l) => (l === '*' ? (out.links = '*') : out.links !== '*' && out.links.add(l));
  const filter = lens?.filter ?? {};
  for (const part of ['find', 'only', 'not']) {
    for (const raw of filter[part] ?? []) {
      const t = String(raw).trim().replace(/\s+/g, ' ');
      const seeds = part === 'find';
      for (const id of t.match(ID) ?? []) out.anchors.add(id);
      const word = WORDS.find(([re]) => re.test(t));
      if (/^(held|moved)$/i.test(t)) out.all = true;
      else if (word) field(...(word[1] === '*' ? ['*'] : word[1]));
      else if (/^(type|kind)\s/i.test(t)) (field('type'), seeds && (out.unanchored = true));
      else if (/^text\s/i.test(t)) (field('title', 'body'), seeds && (out.unanchored = true));
      else if (/^island\s/i.test(t)) (field('island'), out.islands.add(t.slice(7).trim()), seeds && (out.unanchored = true));
      else if (/^id\s/i.test(t)) continue;
      else if (/^owner\s/i.test(t)) (field('owner'), link('*'));
      else if (/^(in|related)\s/i.test(t)) link('*');
      // A link term (`<link> <item>`, `<link>< <item>`) reads that link; a word alone is a type.
      else if (/\s/.test(t)) link(t.split(' ')[0].replace(/<$/, ''));
      else (field('type'), seeds && (out.unanchored = true));
    }
  }
  const walk = lens?.walk;
  if (walk && (walk.steps ?? 1) > 0) {
    const over = walk.over === 'all' || !walk.over ? ['*'] : [walk.over].flat();
    for (const l of over) link(l === 'all' || l === '*' ? '*' : String(l).replace(/[<>]$/, ''));
  }
  return out;
}

/**
 * Whether facts may change which items a lens finds: `view` is { lens, items (the ids it holds), islands (those its
 * items live on) }; `touches` are the facts as the store saw them before folding them in (Store.apply): { id, field,
 * op, link?: { type, from, to }, made?: true, island? }; `made`: how many items the tail says were made anywhere.
 */
export function mayMove(view, touches, made = 0) {
  const r = view.reads ?? reads(view.lens);
  const near = (id) => view.items.has(id) || r.anchors.has(id);
  const islands = new Set([...(view.islands ?? []), ...r.islands]);
  // A view looking at islands hears a new item made on one of them; one that looks across the map, any new item.
  if (r.unanchored && made > 0 && !r.islands.size) return true;
  for (const t of touches) {
    if (t.link) {
      if (!(near(t.link.from) || near(t.link.to))) continue;
      if (r.all || r.links === '*' || r.links.has(t.link.type)) return true;
      continue;
    }
    // An item the store does not hold came only because it lives on an island the open views look at (`?`: which one, the tail does not say).
    const onIsland = t.island === '?' ? islands.size > 0 : t.island !== undefined && islands.has(t.island);
    if (t.made) {
      if (r.unanchored && (!r.islands.size || onIsland)) return true;
      continue;
    }
    if (!(near(t.id) || onIsland)) continue;
    // Brought back from the archive: whether it is found again is the server's to say.
    if (t.field === 'archived' && t.op === '-') return true;
    if (r.all || r.fields === '*' || r.fields.has(t.field)) return true;
  }
  return false;
}
