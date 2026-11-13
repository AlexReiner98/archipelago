// Pointing at what stands for items lights them on the canvas in sight and fades the rest by the style's `dim`: a choice
// of find (ui/find.js), a mark of a part that carries `lights` (packs/walls/page/part-render.js). The page does
// it, not the drawing, so every style lights alike: a mark says the item it stands for (packs/walls/page/marks.js), and
// the rule is one stylesheet, so a mark drawn while the pointer is there (what comes into sight) fades with the rest.

import { state } from './base.js';
import { numberOf } from './style-number.js';

let sheet = null;

/** Keep these items lit in `view` and fade the rest; with none (or no view), take the lighting off. */
export function lightItems(view, ids) {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    document.adoptedStyleSheets.push(sheet);
  }
  if (!ids || !view) {
    if (view?.dataset) delete view.dataset.lighting;
    sheet.replaceSync('');
    view?.lightSurface?.(null);
    return;
  }
  view.dataset.lighting = '';
  const kept = [...ids].map((id) => `[data-item="${id}"]`).join(',');
  sheet.replaceSync(`[data-lighting] [data-item]${kept ? `:not(${kept})` : ''} { opacity: ${numberOf(state.style, 'dim')}; }`);
  view.lightSurface?.([...ids]);
}
