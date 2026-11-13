// An item picked on the canvas for a part (the owner, 10 Nov 2026: a link is started by a button, not dragged on the
// plane). A part's button that says `pick` hands its press here: the next item clicked on the canvas is the one picked,
// told back to the part as what the person did. Escape, or the button again, lets it go. While it waits the page says
// so on <body> (`data-linking`, the item it starts from), for the stylesheet to mark the canvas and the button.

let picking = null;

/** Wait for an item clicked on the canvas: its id, or null when it is let go. `from` is the item it starts from, never itself picked. */
export function pickOnCanvas(from) {
  if (picking) return (picking.stop(), Promise.resolve(null));
  return new Promise((resolve) => {
    const canvas = document.getElementById('canvas');
    // Caught before the canvas hears it: a click on an item there is the one picked, not a way to its page.
    const click = (ev) => {
      const mark = ev.target.closest?.('[data-item]');
      if (!mark || !canvas?.contains(mark) || mark.closest('.lf-island-add')) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (mark.dataset.item === from) return;
      stop(mark.dataset.item);
    };
    // Escape lets it go, and only that: the sheet stays open.
    const key = (ev) => ev.key === 'Escape' && (ev.preventDefault(), ev.stopPropagation(), stop(null));
    const stop = (picked = null) => {
      removeEventListener('click', click, true);
      removeEventListener('keydown', key, true);
      delete document.body.dataset.linking;
      picking = null;
      resolve(picked);
    };
    addEventListener('click', click, true);
    addEventListener('keydown', key, true);
    document.body.dataset.linking = from ?? '';
    picking = { stop: () => stop(null) };
  });
}
