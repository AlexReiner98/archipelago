// Layer: graph. The reflex tree a view's answer holds. Its nodes are the instructions and reflex nodes (a type that is
// one or a flavour of one), each under its branch by part_of; a branch is any item of the answer a node is part of, so
// a project or a folder of rules stands in the tree as the bough its rules grow from. A node part of nothing in the
// answer hangs from boughs named for where it is said (its first `for` place), the general nearest the root: tool,
// then tool's name; file, then its glob's top folders (reflex_file_depth of them: file, packs/, packs/canvas/);
// session_start and working_rules each a bough of their own. At most reflex_place_depth boughs deep. So a map of
// loose rules reads as a tree, not a table. The root is what the view is of (its `from`), else the harness itself.
//
// Each node is { id, item, title, parent, kids, depth, born }: `born` the time its item was made (its create in the
// log), a bough made for it born with its first node; `item` is absent on a bough the tree made.

const ROOT = '~root';

/** A number from 0 to 1 for a text, the same each time. */
export const hash = (text) => {
  let h = 1;
  for (const ch of String(text)) h = (h * 33 + ch.charCodeAt(0)) % 2147483647;
  return ((h * 16807) % 2147483647) / 2147483647;
};

const isNode = (item) => ['instruction', 'reflex'].some((t) => item.type === t || (Array.isArray(item.is) && item.is.includes(t)));
const isPartOf = (link) => link.type === 'part_of' || (Array.isArray(link.is) && link.is.includes('part_of'));
const GLOB = /[*?[{]/;
/**
 * The boughs a place is said under, general first: "tool:change" is [tool, change]; "file:packs/canvas/x/*.js" is
 * [file, packs/, packs/canvas/] for a file depth of 2; "session_start" is [session start]. Each { key, title }.
 */
export const boughsOf = (where, fileDepth, most) => {
  if (typeof where !== 'string' || !where) return [];
  const [kind, ...rest] = where.split(':');
  const out = [{ key: kind, title: kind.replaceAll('_', ' ') }];
  const tail = rest.join(':');
  if (tail && kind === 'file') {
    const folders = tail.split('/').slice(0, -1);
    const plain = folders.slice(0, folders.findIndex((f) => GLOB.test(f)) === -1 ? folders.length : folders.findIndex((f) => GLOB.test(f)));
    plain.slice(0, Math.max(0, fileDepth)).forEach((_, i) => out.push({ key: `file:${plain.slice(0, i + 1).join('/')}/`, title: `${plain[i]}/` }));
  } else if (tail) tail.split(':').forEach((part, i, all) => out.push({ key: `${kind}:${all.slice(0, i + 1).join(':')}`, title: part.replaceAll('_', ' ') }));
  return out.slice(0, Math.max(1, most));
};
const firstPlace = (where) => (Array.isArray(where) ? where.find((w) => typeof w === 'string') : typeof where === 'string' ? where : undefined);

/**
 * The tree in the answer, or null when it holds no node. `placeOf(item)` is where it is said (its `for`), from the
 * answer's fields or from what the pack answered of it; `n` the style's numbers.
 */
export function treeOf(answer, placeOf = (item) => item.fields?.for, n = () => 0, presets = []) {
  // The presets the story names (core's and the packs', no item of the map) stand with the rest, under their places.
  // A rule is one of them, under the place it guards (`where`); it is marked a rule.
  const extra = presets.filter((p) => p && typeof p.id === 'string' && !(answer.items ?? []).some((i) => i.id === p.id)).map((p) => ({ id: p.id, type: 'instruction', title: p.title ?? p.id, preset: true, rule: p.kind === 'rule', fields: { for: p.for } }));
  const items = [...(Array.isArray(answer.items) ? answer.items.filter((i) => !i.pending) : []), ...extra];
  const byId = new Map(items.map((i) => [i.id, i]));
  const up = new Map();
  for (const l of answer.links ?? []) if (isPartOf(l) && !l.pending && byId.has(l.from) && byId.has(l.to) && l.from !== l.to && !up.has(l.from)) up.set(l.from, l.to);
  const from = answer.lens?.from && byId.has(answer.lens.from) ? answer.lens.from : undefined;
  const nodes = new Map();
  const make = (id, item, title) => {
    const node = { id, item: item?.preset ? undefined : item, preset: Boolean(item?.preset), rule: Boolean(item?.rule), title, parent: null, kids: [], depth: 0, born: item?.preset ? -Infinity : item ? Date.parse(item.created_at) : Infinity };
    if (Number.isNaN(node.born)) node.born = Infinity;
    nodes.set(id, node);
    return node;
  };
  const root = from ? make(from, byId.get(from), byId.get(from).title) : make(ROOT, undefined, '');
  // Each node and the boughs it hangs from, up to the root or to a bough already placed; a ring of part_of is cut where it closes.
  const visiting = new Set();
  const place = (item) => {
    if (nodes.has(item.id)) return nodes.get(item.id);
    visiting.add(item.id);
    const node = make(item.id, item, item.title);
    const parentId = item.preset ? undefined : up.get(item.id);
    let parent = parentId === root.id ? root : parentId !== undefined && !visiting.has(parentId) ? place(byId.get(parentId)) : undefined;
    if (!parent) {
      parent = root;
      for (const b of boughsOf(firstPlace(placeOf(item)), n('reflex_file_depth'), n('reflex_place_depth'))) {
        const id = `~for:${b.key}`;
        parent = nodes.get(id) ?? attach(make(id, undefined, b.title), parent);
      }
    }
    visiting.delete(item.id);
    return attach(node, parent);
  };
  const attach = (node, parent) => ((node.parent = parent), parent.kids.push(node), node);
  for (const item of items) if (isNode(item) && item.id !== root.id) place(item);
  if (nodes.size === 1) return null;
  // A bough is as old as its first node: a branch made after what grows from it still stands before it.
  const age = (node) => {
    for (const kid of node.kids) node.born = Math.min(node.born, age(kid));
    return node.born;
  };
  age(root);
  const order = [];
  const deep = (node, depth) => {
    node.depth = depth;
    node.kids.sort((a, b) => a.born - b.born || (a.id < b.id ? -1 : 1));
    order.push(node);
    for (const kid of node.kids) deep(kid, depth + 1);
  };
  deep(root, 0);
  // Born in the order made; a bough before what grows from it.
  const born = order.slice(1).sort((a, b) => a.born - b.born || a.depth - b.depth);
  return { root, nodes, order, born, written: born.filter((n) => n.item && isNode(n.item)) };
}

/** The places a node may be said at by their kind alone, with nothing after it. */
const PLAIN = ['session_start', 'working_rules', 'server_restarted', 'setup_behind'];
/**
 * The place a new node on a bough is said at, or null where none can be (the reflex pack refuses any place that is
 * never said): a tool's or guide's bough by its name, a rule's by its rule, a deeper rule branch at its tool, a file
 * folder as every file under it, and the plain places by their kind.
 */
export const placeOfBough = (id) => {
  const key = String(id).replace(/^~for:/, '');
  const [kind, ...rest] = key.split(':');
  if (!rest.length) return PLAIN.includes(kind) ? kind : null;
  if (kind === 'file') return `file:${rest.join(':').replace(/\/?$/, '/')}**`;
  return ['tool', 'guide', 'rule'].includes(kind) ? `${kind}:${rest[0]}` : null;
};
