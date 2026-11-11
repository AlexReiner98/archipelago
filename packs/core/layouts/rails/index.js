// Rails: the map with a walk through it (decision e_btxq2nzq, the site that opens as a read-only map). The picture is the
// shipped map's own (./map.js, core.map's drawing), mark for mark, so a page baked from a view looks as the product
// does; this only adds the walk. Each item drawn is a stop, read in the view's order (./walk.js), and the scene carries
// `stops` (each item's id, title, first paragraph, and the camera on it: centre x, y, the width of picture it frames
// `span`, and `zoom`, how much nearer than the whole) and `whole`, the camera on everything: what a page that walks the
// picture as it is scrolled reads (packs/reader/public/rails.js). Each item's mark says its item (`item`), for that
// page to light the stop it stands at. Layer: marks. Its lengths are the style's: rails_stop_span, rails_stop_room.

import { picture as map } from './map.js';
import { readingOrder } from './walk.js';

/** A note's first paragraph, plain, for a stop's words. */
const noteOf = (i) => String(i.body ?? i.gist ?? '').split(/\r?\n\s*\r?\n/).map((p) => p.trim()).find((p) => p && !p.startsWith('#')) ?? '';

/** The marks `mark` holds with each link to an item's page (#/e/<id>) saying its item too. */
function said(mark) {
  if (!Array.isArray(mark)) return mark;
  if (typeof mark[0] !== 'string') return mark.map(said);
  const [tag, attrs, ...kids] = mark, to = typeof attrs?.href === 'string' && attrs.href.match(/^#\/e\/(.+)$/);
  return [tag, to ? { ...attrs, item: to[1] } : attrs, ...kids.map(said)];
}

/** The picture: the map's, with its stops. */
export function picture(args, tools) {
  const drawn = map(args, tools), scene = drawn.scene;
  if (!scene?.places?.length) return drawn;
  const { sizes = {} } = args.style, at = new Map(scene.places.map((p) => [p.id, p]));
  const items = (args.answer?.items ?? []).filter((i) => at.has(i.id));
  const width = scene.size.width, height = scene.size.height;
  // The camera on each stop: its centre, framing rails_stop_span of the picture across, never less than its box and
  // rails_stop_room each side; `zoom` is how much nearer that is than the whole picture.
  const stops = readingOrder(items, args.answer?.links ?? []).map((i) => {
    const p = at.get(i.id), span = Math.max(sizes.rails_stop_span, p.w + 2 * sizes.rails_stop_room);
    return { id: i.id, title: i.title, note: noteOf(i), x: p.x, y: p.y, span, zoom: width / span };
  });
  return { ...drawn, scene: { ...scene, svg: said(scene.svg), stops, whole: { x: width / 2, y: height / 2, span: width, zoom: 1 } } };
}
