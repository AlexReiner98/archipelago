// A kept view beside a picture: the `view` mark a drawing may make (ui/marks.js), as a story's player does for the
// milestone a step reaches (packs/canvas/layouts/architecture/play.js, used by the map). A drawing names only the view; the page draws it.
// On a canvas, it is drawn in a pane of its own beside the drawing's (hooks.besidePane, ui/panes.js), so the reader
// slides the sash between them (the owner, 2 Nov 2026, e_dnewbxxh); the frame itself stays empty. Elsewhere (a
// document), it is drawn in the frame as it is kept (keptView, ui/canvases.js), in the sandbox as every picture is:
// named again (a patch with the mark whole), the new view is drawn under the old, out of sight, and takes its place
// once it has drawn, so nothing jumps; named with no id, the frame is empty.

import { h, hooks } from './base.js';

const ID = /^e_[a-z0-9]{8}$/;

export function viewFrame(attrs, fail) {
  const el = h('div', { class: 'view-frame' });
  let at;
  const draw = (want) => {
    // Where it stands is known once the mark is on the page.
    const pane = el.closest('[data-pane]')?.dataset.pane;
    if (pane && hooks.besidePane) return void (el.classList.add('beside'), hooks.besidePane(pane, want));
    for (const old of el.querySelectorAll(':scope > .view-next')) old.remove();
    // A page that draws no kept views (one with no canvases) leaves the frame empty.
    if (!want || !hooks.keptView) return el.replaceChildren();
    const next = hooks.keptView(want);
    next.classList.add('view-next');
    el.append(next);
    const done = () => {
      if (at !== want || !next.isConnected) return;
      next.classList.remove('view-next');
      for (const old of [...el.children]) if (old !== next) old.remove();
    };
    Promise.resolve(next.ready).then(done, done);
  };
  const show = (id) => {
    if (id != null && !ID.test(String(id))) fail(`the view "${String(id).slice(0, 80)}"`);
    const want = id == null ? null : String(id);
    if (want === at) return;
    at = want;
    requestAnimationFrame(() => at === want && draw(want));
  };
  el.swap = (mark) => (Array.isArray(mark) && mark[0] === 'view' ? (show(mark[1]?.id), true) : false);
  show(attrs.id);
  return el;
}
