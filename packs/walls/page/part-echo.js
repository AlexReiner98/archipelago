// A field's words while the person types (packs/walls/page/part-render.js): what the part answers a field with is set in it,
// unless it is an echo of the person's own typing, which is let be so a field being typed in keeps its words and caret.

/**
 * Whether a value the part answers a field with is set in it, or is an echo of the person's own typing let be. `heard`
 * is what the field has sent, oldest first, and is kept current here: an answer that has caught up with the field
 * (the same words) or with a value sent later forgets what was sent before it, so an old value the part sends again
 * on purpose (the field cleared once its words were taken) is set, not taken for an echo. Out of the field, it is set.
 */
export function setsField(heard, value, now, focused) {
  if (value === now) return (heard.length = 0), false;
  const at = focused ? heard.lastIndexOf(value) : -1;
  if (at < 0) return (heard.length = 0), true;
  heard.splice(0, at);
  return false;
}
