// Scrolling moves along the rails (task e_u2sxep5g; decision e_btxq2nzq). A page baked from a view drawn by core's
// rails (packs/canvas/layouts/rails) holds the picture's marks as an SVG and its stops as a list; this lets the page's
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
// Wide, the map fills a screen held still while the page scrolls, and the scroll only moves the camera: the cards do
// not scroll past. The stop the camera rests on is lit, the rest dimmed, and its words stand in one callout beside its
// box, tied to it by a short leader, shown only while the camera is at rest there (the owner, 11 Nov 2026, question
// e_m7tssx3y). A row of dots at the foot is the walk: where you are, and a link to each stop. The list stays in the
// page, out of sight, for the browser's find and a screen reader. Narrower than the style's rails_narrow_at (read as
// --ln-rails-narrow-at), the walk is drawn as a column of cards, wires between, nothing panned. Asked for less motion,
// it leaves the page plain. Every length is the style's, read by rails.css as --ln-rails-*.

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
  const stage = root.querySelector('.rails-stage');
  // The callout and the dots are the script's: with no script the page has neither.
  const callout = Object.assign(doc.createElement('div'), { className: 'rails-callout' });
  callout.setAttribute('aria-hidden', 'true');
  const dots = Object.assign(doc.createElement('nav'), { className: 'rails-dots' });
  dots.setAttribute('aria-label', 'Stops');
  for (const s of stops) {
    const a = Object.assign(doc.createElement('a'), { href: `#${s.li.id}`, title: s.li.querySelector('h2')?.textContent ?? '' });
    a.dataset.item = s.id;
    dots.append(a);
  }
  stage.append(callout, dots);
  stage.style.setProperty('--rails-fade', `${number('--ln-rails-fade-ms') || 0}ms`);
  const narrow = () => win.innerWidth <= (number('--ln-rails-narrow-at') || 0);
  const mode = () => (still.matches ? 'plain' : narrow() ? 'column' : 'walk');
  // Where each camera is reached: the whole at the section's top, each stop when its (unseen) place in the list stands mid-screen.
  const measure = () => {
    const top = root.getBoundingClientRect().top + win.scrollY;
    marks = [top, ...stops.map((s) => {
      const r = s.li.getBoundingClientRect();
      return r.top + win.scrollY + r.height / 2 - win.innerHeight / 2;
    })];
  };
  const light = (id) => {
    if (id === here) return;
    for (const el of stage.querySelectorAll('.here, .past')) el.classList.remove('here', 'past');
    if (id) for (const el of stage.querySelectorAll(`[data-item="${CSS.escape(id)}"]`)) el.classList.add('here');
    const k = stops.findIndex((s) => s.id === id);
    [...dots.children].slice(0, Math.max(0, k)).forEach((a) => a.classList.add('past'));
    stage.classList.toggle('lit', Boolean(id));
    callout.replaceChildren(...(id ? [Object.assign(doc.createElement('div'), { className: 'rails-count', textContent: `${k + 1} / ${stops.length}` }), ...[...stops[k].li.querySelector('.rails-card').childNodes].map((n) => n.cloneNode(true))] : []));
    here = id;
  };
  // The callout stands right of its box, its leader's length away, kept inside the stage.
  const place = (id, k) => {
    const mark = id && svg.querySelector(`[data-item="${CSS.escape(id)}"]`), still = number('--ln-rails-callout-still') || 0;
    const resting = mark && Math.abs(win.scrollY - marks[k]) <= still * win.innerHeight;
    callout.classList.toggle('on', Boolean(resting));
    if (!resting) return;
    const at = mark.getBoundingClientRect(), from = stage.getBoundingClientRect(), lead = number('--ln-rails-leader') || 0, inset = number('--ln-rails-card-inset') || 0;
    const left = Math.min(at.right - from.left + lead, from.width - callout.offsetWidth - inset);
    const top = Math.min(Math.max(inset, at.top - from.top), from.height - callout.offsetHeight - inset);
    callout.style.transform = `translate(${left}px, ${top}px)`;
    callout.style.setProperty('--rails-lead-y', `${at.top + at.height / 2 - from.top - top}px`);
  };
  const draw = () => {
    frame = 0;
    if (root.dataset.rails !== 'walk') return;
    // The camera centres a stop in the room left of where its callout will stand, the whole across all of the stage.
    const room = stage.getBoundingClientRect(), side = callout.offsetWidth + (number('--ln-rails-leader') || 0);
    const first = wholeIn(whole, box, room.width, room.height);
    const c = cameraAt([first, ...stops.map((s) => s.at)], marks, win.scrollY, number('--ln-rails-ease') || 0);
    const f = framing(c, { left: 0, width: c.k > 0 ? Math.max(room.width / 2, room.width - side) : room.width, height: room.height });
    svg.style.transform = `translate(${f.x}px, ${f.y}px) scale(${f.scale})`;
    const id = c.k > 0 ? stops[c.k - 1].id : undefined;
    light(id);
    place(id, c.k);
  };
  const ask = () => (frame ||= win.requestAnimationFrame(draw));
  const settle = () => {
    root.dataset.rails = mode();
    html.classList.toggle('rails-walking', root.dataset.rails === 'walk');
    if (root.dataset.rails !== 'walk') (svg.style.transform = '', light(undefined), callout.classList.remove('on'));
    measure();
    ask();
  };
  // A press on a stop in the picture goes to its card, as a link to it would.
  stage.addEventListener('click', (e) => {
    const id = e.target.closest?.('svg [data-item], .rails-dots [data-item]')?.dataset.item, li = stops.find((s) => s.id === id)?.li;
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
