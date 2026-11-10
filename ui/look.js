// The page in look mode (`?look`): opened by the server's own browser for an agent's look (src/look-draw.ts), never by
// a person. It follows no agent and counts as no page of the owner's (ui/live.js). It says on its root when the
// canvas has drawn, so the server takes the picture then and not before: `data-look` is drawing, then drawn, empty
// (the lens found nothing) or error, with `data-look-why`. A view says so with a `view-drawn` event, raised where its
// drawing is done: the lens found nothing or failed (ui/query.js), a drawing mounted its scene and a surface painted its
// first frame (ui/layout.js), a layout's code returned and its worker painted (ui/style-code.js). A document's
// preview (ui/doc.js) says so itself, once it has drawn the page.

export const lookMode = new URLSearchParams(location.search).has('look');
/** A page that draws once and follows nothing: a look, or a frozen link opened at /s/ (ui/base.js `link`), which never changes. */
export const still = lookMode || /^\/s\//.test(location.pathname);

/** Say that the view in `el` has drawn: drawn, empty or error, and why. */
export const saidDrawn = (el, state, why) => el.dispatchEvent(new CustomEvent('view-drawn', { bubbles: true, detail: { state, why } }));

const root = document.documentElement;

/** Say, as the page's first word, that it has drawn: two frames on, so what was mounted has been painted. */
export function sayLook(state, why) {
  if (!lookMode || root.dataset.look !== 'drawing' || root.dataset.lookSaid) return;
  root.dataset.lookSaid = '1';
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      if (why) root.dataset.lookWhy = String(why).slice(0, 300);
      root.dataset.look = ['drawn', 'empty', 'error'].includes(state) ? state : 'drawn';
    }),
  );
}

if (lookMode) {
  // The drawing as marks, for a look that asks for them (src/look-draw.ts): loaded only here.
  window.lookMarks = async () => (await import('./look-marks.js')).marksOf(document.querySelector('#canvas [data-drawing]'));
  root.dataset.look = 'drawing';
  // The canvas's first word is the one taken.
  document.getElementById('canvas')?.addEventListener('view-drawn', (ev) => sayLook(ev.detail?.state, ev.detail?.why));
}
