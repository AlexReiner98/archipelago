// A box that fits (`fits` on a box mark): it shows as many of its marks as fit on one line and says how many are left,
// as the bar's terms do. The part says what is in the box and nothing of how wide the page is; the host measures, so
// the same marks fit a wide screen and a narrow one without the part being asked again (one line per row, docs/canvas.md).
//
// Nothing here is a gesture: what is left over is said in the box's own tip and stays in the page for the keyboard, so
// a mark that is not shown is still reached. The count is drawn by the host, never by the part.

/** The mark that says how many are left over, made once per box. */
function countIn(el) {
  let count = el.querySelector(':scope > .pm-fits-rest');
  if (!count) {
    count = Object.assign(document.createElement('span'), { className: 'pm-text pm-text-muted pm-fits-rest' });
    el.append(count);
  }
  return count;
}

/**
 * Show as many of `el`'s marks as fit on one line. Called when it is drawn and whenever its width changes; it reads
 * the page and writes only hidden and the count, so it never moves anything the style placed.
 */
export function fitOnce(el) {
  const count = countIn(el);
  const kids = [...el.children].filter((k) => k !== count);
  for (const k of kids) k.hidden = false;
  count.hidden = true;
  const room = el.clientWidth;
  if (!room || el.scrollWidth <= room) return;
  // The count stands with them, so it is shown and measured first and what is left must fit beside it.
  count.hidden = false;
  count.textContent = `+${kids.length}`;
  const beside = room - count.offsetWidth;
  let rest = 0;
  for (let i = kids.length - 1; i >= 0 && el.scrollWidth > beside; i--) {
    kids[i].hidden = true;
    rest++;
  }
  if (!rest) return void (count.hidden = true);
  count.textContent = `+${rest}`;
  const left = kids.filter((k) => k.hidden).map((k) => k.textContent?.trim()).filter(Boolean);
  count.title = left.join(', ').slice(0, 300);
}

/** Every box that fits, measured again when its width changes. One observer for the page. */
const watching = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => entries.forEach((e) => fitOnce(e.target))) : null;

/** Watch this box (or stop watching it) as its mark says it fits or no longer does. */
export function fits(el, on) {
  if (!watching) return;
  if (on) (watching.observe(el), fitOnce(el));
  else {
    watching.unobserve(el);
    const count = el.querySelector(':scope > .pm-fits-rest');
    if (count) count.remove();
    for (const k of el.children) k.hidden = false;
  }
}
