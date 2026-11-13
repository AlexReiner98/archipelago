// How the host makes an element: the one helper every page module draws with (packs/kit/page/base.js hands it on
// to the app as `h`). Kept in walls, before every root that draws, so a host module draws without the page's state.

/** An element: `attrs` set as properties where the element has one, `on…` as listeners; kids flattened, words as text. */
export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs ?? {})) {
    if (value == null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'class') el.className = value;
    else if (key in el) el[key] = value;
    else el.setAttribute(key, value);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
