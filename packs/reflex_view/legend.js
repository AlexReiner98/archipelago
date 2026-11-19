// The tree's legend as a filter: each toggle hides or shows one entry (kind:rule, pack:<id>, tier:<t>, status:<s>,
// event:<e>) by changing the view's own style, its hidden list, on the person's authority. Decided without the map:
// the view as read and the toggle in, one op out. A view a pack ships is no item: the first toggle makes the owner's
// version of it (a lens naming it as its preset), its style the one drawn with.

/** The entries a legend may hide: what the tree tells apart. */
export const ENTRY = /^(kind:(rule|instruction)|pack:[a-z][a-z0-9_]*|tier:(core|pack|owner|learned)|status:(trial|current|retired)|event:(miss|held|failed|fired))$/;

/** The hidden list after a toggle: an entry hidden when off, shown again when on, each once, in order. */
export const toggled = (hidden, entry, on) => {
  const now = (Array.isArray(hidden) ? hidden : []).filter((e) => typeof e === 'string' && e !== entry);
  return on ? now : [...now, entry];
};

/**
 * The op a toggle makes: an update of the kept lens (the view itself, or the owner's version of a preset), merging
 * hidden into its own style; or, where the view is a preset with no version yet, the version made with the style drawn.
 */
export function legendOps({ view, entry, on, style, filter, walk, limit }, kept) {
  if (!ENTRY.test(String(entry ?? ''))) throw new Error(`entry is one of kind:rule|instruction, pack:<id>, tier:core|pack|owner|learned, status:trial|current|retired, event:miss|held|failed|fired: not "${entry}"`);
  if (typeof on !== 'boolean') throw new Error('on is true (show it) or false (hide it)');
  if (kept) {
    const own = kept.props?.style && typeof kept.props.style === 'object' ? kept.props.style : {};
    return { ops: [{ op: 'update', id: kept.id, props: { style: { ...own, hidden: toggled(own.hidden, entry, on) } } }] };
  }
  if (typeof view !== 'string' || !view || view.startsWith('e_')) throw new Error('view is the lens the legend is on, or the id of the view a pack ships');
  const drawn = style && typeof style === 'object' ? style : {};
  // Its query as the preset's, given by the drawing that holds it, so the version draws what the view drew.
  const query = { ...(filter && typeof filter === 'object' && { filter }), ...(walk && typeof walk === 'object' && { walk }), ...(Number.isInteger(limit) && { limit }) };
  return { ops: [{ op: 'create', type: 'lens', title: typeof drawn.title === 'string' ? drawn.title : 'Reflex tree', props: { preset: view, ...query, style: { ...drawn, hidden: toggled(drawn.hidden, entry, on) } } }] };
}

/** The longest a node's name may be: a name is a few words. */
const TITLE_MOST = 60;

/**
 * A node added on a branch of the tree: a trial reflex said where the branch is (for), named as the person typed it,
 * its words what they said or, with none, its name. Whether its place is one that is said is the reflex pack's rule.
 */
export function addNodeOps({ for: where, title, body }) {
  const name = String(title ?? '').trim();
  if (!name) throw new Error('A node is named: what to say there, in a few words');
  if (name.length > TITLE_MOST) throw new Error(`A node's name is ${TITLE_MOST} characters at most (this is ${name.length}): say the rest in its words`);
  if (typeof where !== 'string' || !where.trim()) throw new Error('for is the place the node is said at, as the branch names it');
  const words = String(body ?? '').trim() || name;
  return { ops: [{ op: 'create', type: 'reflex', status: 'trial', title: name, body: words, props: { for: [where.trim()] } }] };
}
