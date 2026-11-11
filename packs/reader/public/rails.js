// Scrolling moves along the rails (task e_u2sxep5g; decision e_btxq2nzq). A page baked from a view drawn by core's
// rails (packs/core/layouts/rails) holds the picture's marks as an SVG and its stops as a list; this lets the page's
// own scroll carry the camera from stop to stop. It never hears the wheel: the page scrolls as any page does, so keys,
// links to a stop (#s-<id>) and the browser's find all work, and the camera only follows where the page stands.
//
// The markup it reads (the baked page writes it; with no script it is a plain page of titles and notes):
//
//   <section class="rails" data-whole="x y span">
//     <div class="rails-stage"><svg viewBox="0 0 W H">…the drawing's marks…</svg></div>
//     <ol class="rails-stops">
//       <li class="rails-stop" id="s-<item id>" data-item="<item id>" data-at="x y span">
//         <div class="rails-card"><h2>title</h2><p>note</p></div>
//       </li> …
//     </ol>
//   </section>
//
// Wide, the stage stands still behind the cards and the picture moves under it; narrower than the style's
// rails_narrow_at (read as --ln-rails-narrow-at), the walk is drawn as a column of cards, wires between, nothing panned.
// Asked for less motion, it leaves the page plain. Every length is the style's, read by rails.css as --ln-rails-*.

/** A camera: where it looks (x, y, in the picture's units) and how wide a stretch of the picture it frames. */
const read = (text) => {
  const [x, y, span] = String(text ?? '').trim().split(/\s+/).map(Number);
  return [x, y, span].every(Number.isFinite) && span > 0 ? { x, y, span } : null;
};

/** Smooth at both ends when `ease` is 1, straight when 0, and between as it says. */
const eased = (t, ease) => (1 - ease) * t + ease * t * t * (3 - 2 * t);

/**
 * The camera at page position `at`: `marks` are the positions each camera is reached at, in order (the first the
 * whole picture, then each stop), `cameras` the cameras there. Between two it moves straight across and zooms evenly.
 */
export function cameraAt(cameras, marks, at, ease = 1) {
  if (!cameras.length) return null;
  if (at <= marks[0]) return cameras[0];
  for (let k = 1; k < cameras.length; k++) {
    if (at > marks[k]) continue;
    const t = eased((at - marks[k - 1]) / Math.max(1, marks[k] - marks[k - 1]), ease), [p, q] = [cameras[k - 1], cameras[k]];
    return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, span: p.span * (q.span / p.span) ** t, k: t < 1 / 2 ? k - 1 : k };
  }
  return { ...cameras.at(-1), k: cameras.length - 1 };
}

/** The transform that puts camera `c` at the middle of the free room of the stage (`left` to `width`, `height` tall). */
export function framing(c, { left, width, height }) {
  const room = Math.max(1, width - left), scale = room / c.span;
  return { scale, x: left + room / 2 - c.x * scale, y: height / 2 - c.y * scale };
}

/** The camera on the whole picture, wide enough that all of it, `picture` tall too, fits the free room. */
export const wholeIn = (whole, picture, room, height) => ({ ...whole, span: Math.max(whole.span, (picture.height * room) / Math.max(1, height)) });

/** Walk one baked picture: the rails section `root`, in `win`. */
export function walk(root, win = window) {
  const doc = root.ownerDocument, html = doc.documentElement, svg = root.querySelector('.rails-stage svg');
  const stops = [...root.querySelectorAll('.rails-stop')].map((li) => ({ li, id: li.dataset.item, at: read(li.dataset.at) })).filter((s) => s.at);
  const whole = read(root.dataset.whole), box = svg?.viewBox?.baseVal;
  if (!svg || !box || !whole || !stops.length) return null;
  // Drawn at its own size, one unit a pixel, where the page did not say.
  for (const side of ['width', 'height']) if (!svg.hasAttribute(side)) svg.setAttribute(side, String(box[side]));
  const vars = win.getComputedStyle(html), number = (name) => Number.parseFloat(vars.getPropertyValue(name));
  const still = win.matchMedia('(prefers-reduced-motion: reduce)');
  let marks = [], frame = 0, here;
  const narrow = () => win.innerWidth <= (number('--ln-rails-narrow-at') || 0);
  const mode = () => (still.matches ? 'plain' : narrow() ? 'column' : 'walk');
  // Where each camera is reached: the whole at the section's top, each stop when its card stands mid-screen.
  const measure = () => {
    const top = root.getBoundingClientRect().top + win.scrollY;
    marks = [top, ...stops.map((s) => {
      const r = s.li.getBoundingClientRect();
      return r.top + win.scrollY + r.height / 2 - win.innerHeight / 2;
    })];
  };
  const light = (id) => {
    if (id === here) return;
    for (const el of root.querySelectorAll('.rails-stage .here')) el.classList.remove('here');
    if (id) for (const el of root.querySelectorAll(`.rails-stage [data-item="${CSS.escape(id)}"]`)) el.classList.add('here');
    here = id;
  };
  const draw = () => {
    frame = 0;
    if (root.dataset.rails !== 'walk') return;
    const card = root.querySelector('.rails-card')?.getBoundingClientRect(), stage = root.querySelector('.rails-stage').getBoundingClientRect();
    const left = card ? card.right - stage.left : 0, first = wholeIn(whole, box, stage.width - left, stage.height);
    const c = cameraAt([first, ...stops.map((s) => s.at)], marks, win.scrollY, number('--ln-rails-ease') || 0);
    const f = framing(c, { left, width: stage.width, height: stage.height });
    svg.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.scale})`;
    light(c.k > 0 ? stops[c.k - 1].id : undefined);
  };
  const ask = () => (frame ||= win.requestAnimationFrame(draw));
  const settle = () => {
    root.dataset.rails = mode();
    html.classList.toggle('rails-walking', root.dataset.rails === 'walk');
    if (root.dataset.rails !== 'walk') (svg.style.transform = '', light(undefined));
    measure();
    ask();
  };
  // A press on a stop in the picture goes to its card, as a link to it would.
  root.querySelector('.rails-stage').addEventListener('click', (e) => {
    const id = e.target.closest?.('[data-item]')?.dataset.item, li = stops.find((s) => s.id === id)?.li;
    if (!li || root.dataset.rails !== 'walk') return;
    e.preventDefault();
    li.scrollIntoView({ block: 'center', behavior: 'smooth' });
    win.history.replaceState(null, '', `#${li.id}`);
  });
  win.addEventListener('scroll', ask, { passive: true });
  win.addEventListener('resize', settle);
  still.addEventListener?.('change', settle);
  settle();
  return { settle, stops };
}

if (typeof document !== 'undefined') for (const root of document.querySelectorAll('.rails')) walk(root);
