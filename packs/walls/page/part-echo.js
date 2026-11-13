// A field's words while the person types (packs/walls/page/part-render.js): what the part answers a field with is set in
// it, unless the part drew it before it heard what the person last typed there, which is let be so a field being typed
// in keeps its words and caret, and a stale answer never takes them away.
//
// Every message the host sends a part is numbered (packs/surface/page/part-host.js), and every answer the part gives
// says the number of the last one it had heard (`seen`, packs/walls/page/draw-inside.js). A field keeps the number of
// the last words it sent (`sent`): an answer that had not heard them is behind the person, whatever it says. One that
// had is the part's own say, and is set even in the field the person is in (the field cleared once its words were
// taken). Where nothing is numbered (a page drawn with no part behind it), the part has its way.

/**
 * Whether a value the part answers a field with is set in it. `now` is what the field holds, `sent` the number of the
 * last words it sent the part, `seen` the number of the last message the part had heard when it answered.
 */
export function setsField(value, now, sent, seen) {
  if (value === now) return false;
  return !(Number.isFinite(sent) && Number.isFinite(seen) && seen < sent);
}
