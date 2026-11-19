// Layer: graph. The reflex tree a view's answer holds. Its nodes are the instructions and reflex nodes (a type that is
// one or a flavour of one), each under its branch by part_of; a branch is any item of the answer a node is part of, so
// a project or a folder of rules stands in the tree as the bough its rules grow from. A node part of nothing in the
// answer hangs from a bough named for where it is said (its `for`: file, tool, guide, session_start...), so a map of
// loose rules still reads as a tree. The root is what the view is of (its `from`), else the harness itself.
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
/** Where a node is said, its first place's kind: "file:packs/**" is said at file. */
const saidAt = (item) => {
  const where = item.fields?.for;
  const first = Array.isArray(where) ? where[0] : typeof where === 'string' ? where : undefined;
  return typeof first === 'string' && first ? first.split(':')[0] : undefined;
};

/** The tree in the answer, or null when it holds no node. */
export function treeOf(answer) {
  const items = Array.isArray(answer.items) ? answer.items.filter((i) => !i.pending) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const up = new Map();
  for (const l of answer.links ?? []) if (isPartOf(l) && !l.pending && byId.has(l.from) && byId.has(l.to) && l.from !== l.to && !up.has(l.from)) up.set(l.from, l.to);
  const from = answer.lens?.from && byId.has(answer.lens.from) ? answer.lens.from : undefined;
  const nodes = new Map();
  const make = (id, item, title) => {
    const node = { id, item, title, parent: null, kids: [], depth: 0, born: item ? Date.parse(item.created_at) : Infinity };
    if (!Number.isFinite(node.born)) node.born = Infinity;
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
    const parentId = up.get(item.id);
    let parent = parentId === root.id ? root : parentId !== undefined && !visiting.has(parentId) ? place(byId.get(parentId)) : undefined;
    if (!parent) {
      const kind = saidAt(item);
      parent = kind ? nodes.get(`~for:${kind}`) ?? attach(make(`~for:${kind}`, undefined, kind.replaceAll('_', ' ')), root) : root;
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
