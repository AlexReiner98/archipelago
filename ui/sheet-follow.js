// A sheet that follows the reading: with an item's page open beside a picture of documents (a scene that says `beside`),
// the page shown is the document in sight, as it is scrolled to. Moving on from one is a step of no one's history (the
// address is replaced), and never leaves unsaved words behind: while there are any, the sheet stays.

import { state } from './base.js';
import { numberOf } from './lens-base.js';

const HERE = /^#\/e\/(e_[a-z0-9]{8})/;

/** The share of the page's width an open sheet takes from the panes (ui/panes.js); one as wide as the page leaves nothing beside it, and takes none. */
export function sheetAside() {
  const sheet = document.getElementById('sheet');
  return document.body.dataset.sheet === 'open' && sheet.offsetWidth < innerWidth * 0.8 ? sheet.offsetWidth / innerWidth : 0;
}

/** While the sheet stands beside `host`, what is published gives way to the draft. */
function draftBeside(host) {
  const fit = () => {
    if (!host.isConnected) return stop();
    host.classList.toggle('sheet-over', sheetAside() > 0 && host.classList.contains('beside-sheet'));
  };
  const bars = new MutationObserver(fit);
  const stop = () => (bars.disconnect(), removeEventListener('resize', fit));
  bars.observe(document.body, { attributes: true, attributeFilter: ['data-sheet', 'data-panes'] });
  addEventListener('resize', fit);
  fit();
}

/**
 * Follow the reading in `host`, which scrolls. `bring`, if it is opened on one document, puts that one back in sight
 * as the frames above it take their height; the sheet moves on from it only once they have.
 */
export function followSheet(host, picture, bring) {
  let holding = false;
  if (bring) {
    holding = true;
    let quiet;
    const sight = new ResizeObserver(() => {
      bring();
      clearTimeout(quiet);
      quiet = setTimeout(() => ((holding = false), sight.disconnect()), numberOf(state.style, 'sheet_follow_still'));
    });
    sight.observe(picture);
  }
  if (host.following) return;
  host.following = true;
  draftBeside(host);
  document.getElementById('sheet').dispatchEvent(new Event('beside'));
  const follow = () => {
    const open = HERE.exec(location.hash);
    if (!open || holding || !host.isConnected || document.querySelector('#sheet [data-draft="unsaved"]')) return;
    const { top, height } = host.getBoundingClientRect();
    // What is in sight is what stands this share of the way down the pane.
    const line = top + height * numberOf(state.style, 'sheet_follow_line');
    const row = [...host.querySelectorAll('.rd')].find((el) => {
      const at = el.getBoundingClientRect();
      return at.height > 0 && at.top <= line && at.bottom >= line;
    });
    const id = row?.dataset.item;
    if (id && id !== open[1]) location.replace(location.hash.replace(open[1], id));
  };
  let wait;
  host.addEventListener('scroll', () => (clearTimeout(wait), (wait = setTimeout(follow, numberOf(state.style, 'sheet_follow_after')))), { passive: true });
}
