// The page in look mode (`?look`): opened by the server's own browser for an agent's look (src/look-draw.ts), never by
// a person. It follows no agent and counts as no page of the owner's (ui/live.js). It says on its root when the
// canvas has drawn, so the server takes the picture then and not before: `data-look` is drawing, then drawn, empty
// (the lens found nothing) or error, with `data-look-why`. A view says so with a `view-drawn` event, raised where its
// drawing is done: the lens found nothing or failed (ui/query.js), a drawing mounted its scene and a surface painted its
// first frame (ui/layout.js), a style's own code returned and its worker painted (ui/style-code.js).

export const lookMode = new URLSearchParams(location.search).has('look');

/** Say that the view in `el` has drawn: drawn, empty or error, and why. */
export const saidDrawn = (el, state, why) => el.dispatchEvent(new CustomEvent('view-drawn', { bubbles: true, detail: { state, why } }));

if (lookMode) {
  const root = document.documentElement;
  root.dataset.look = 'drawing';
  // The canvas's first word is the one taken; two frames on, so what was mounted has been painted.
  document.getElementById('canvas')?.addEventListener('view-drawn', (ev) => {
    if (root.dataset.look !== 'drawing' || root.dataset.lookSaid) return;
    root.dataset.lookSaid = '1';
    const { state, why } = ev.detail ?? {};
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (why) root.dataset.lookWhy = String(why).slice(0, 300);
        root.dataset.look = ['drawn', 'empty', 'error'].includes(state) ? state : 'drawn';
      }),
    );
  });
}
