// The layout switch's choices: the layouts the packs ship by their shape (the first is the default, the choice of
// none), then those kept on the map by name; one a view is drawn in that is no longer listed stays a choice while it is.

/** What is asked of a pane, as one choice: a layout a pack ships, one kept by its id, or the default (''). */
export const chosenOf = (layout) => (layout?.style ? `style:${layout.style}` : layout?.shape ? `shape:${layout.shape}` : '');

/** The choice back as a layout an address names: { shape }, { style }, or {} for the default. */
export function layoutOf(value) {
  const at = typeof value === 'string' ? value.indexOf(':') : -1;
  if (at < 0) return {};
  const [kind, name] = [value.slice(0, at), value.slice(at + 1)];
  return (kind === 'shape' || kind === 'style') && name ? { [kind]: name } : {};
}

/** The values and their names for the pick, and the name of the one chosen, from the layouts read and the layout up. */
export function choicesOf(listed, layout) {
  const [first, ...shapes] = listed?.shapes ?? [];
  const kept = [...(listed?.kept ?? [])];
  // A style the view is drawn with that is no layout (Use here) is one more choice while it is, called by its title.
  const named = (listed?.named ?? []).find((n) => n.id === layout?.style);
  if (layout?.style && !kept.some((k) => k.id === layout.style)) kept.push({ id: layout.style, title: named?.title ?? 'Style', views: 0 });
  const values = ['', ...shapes.map((s) => `shape:${s.shape}`), ...kept.map((k) => `style:${k.id}`)];
  const names = [first?.title ?? 'Default', ...shapes.map((s) => s.title), ...kept.map((k) => k.title)];
  const now = chosenOf(layout);
  const value = values.includes(now) ? now : '';
  return { values, names, value, said: names[values.indexOf(value)] };
}

/** The kept layout the view is drawn in, if the switch may delete it: one kept on the map and listed. */
export const deletable = (listed, layout) => (layout?.style ? (listed?.kept ?? []).find((k) => k.id === layout.style) : undefined);
