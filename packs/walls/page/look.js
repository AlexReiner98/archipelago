// The page in look mode (`?look`): opened by the server's own browser for an agent's look (packs/look_draw/kernel/look-draw.ts), never by
// a person. It follows no agent and counts as no page of the owner's (packs/surface/page/live.js). The page says on its
// root when the canvas has drawn, so the server takes the picture then and not before: `data-look` is drawing, then
// drawn, empty (the lens found nothing) or error, with `data-look_why`. A view says so with a `view-drawn` event, raised
// where its drawing is done: the lens found nothing or failed (packs/surface/page/query.js), a drawing mounted its scene
// and a surface painted its first frame (packs/walls/page/layout.js), a layout's code returned and its worker painted
// (packs/walls/page/style-code.js). A document's preview (ui/doc.js) says so itself, once it has drawn the page.
//
// What the look reads of the first word is look_draw's part (packs/look_draw/parts/page): the runtime mounts it in the
// slot `look` two frames on (packs/kit/page/base.js), and the part publishes it as page state on the root.

export const lookMode = new URLSearchParams(location.search).has('look');
/** A page that draws once and follows nothing: a look. */
export const still = lookMode;

/** Say that the view in `el` has drawn: drawn, empty or error, and why. */
export const saidDrawn = (el, state, why) => el.dispatchEvent(new CustomEvent('view-drawn', { bubbles: true, detail: { state, why } }));

const root = document.documentElement;

/** The page's own word that it has drawn, where no canvas says it (a document's preview). */
export function sayLook(state, why) {
  if (lookMode) saidDrawn(root, state, why);
}

if (lookMode) {
  // The drawing as marks, for a look that asks for them (packs/look_draw/kernel/look-draw.ts): loaded only here.
  window.lookMarks = async () => (await import('./look-marks.js')).marksOf(document.querySelector('#canvas [data-drawing]'));
  root.dataset.look = 'drawing';
}
