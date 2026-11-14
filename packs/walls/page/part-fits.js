// A box that fits (`fits` on a box mark): it shows as many of its marks as fit on one line and says how many are left,
// as the bar's terms do. The part says what is in the box and nothing of how wide the page is; the host measures, so
// the same marks fit a wide screen and a narrow one without the part being asked again (one line per row, docs/canvas.md).
//
// At least one mark is shown, however narrow. What is left over is said in the count's tip, joined from the tips (else
// the words) of the marks it holds. The count is drawn by the host, never by the part: where the part names a key for
// it (`more`), it is a button, and its press goes back as { key: more, name: 'press', value: N } (`el.fitsMore(N)`).

/** The mark that says how many are left over, made once per box (again when it becomes a button or stops being one), kept last. */
function countIn(el) {
  const button = typeof el.fitsMore === 'function';
  let count = el.querySelector(':scope > .pm-fits-rest');
  if (count && (count.tagName === 'BUTTON') !== button) (count.remove(), (count = null));
  if (!count) {
    count = document.createElement(button ? 'button' : 'span');
    count.className = button ? 'pm-button pm-button-quiet pm-fits-rest' : 'pm-text pm-text-muted pm-fits-rest';
    if (button) {
      count.type = 'button';
      count.addEventListener('click', () => el.fitsMore?.(Number(count.dataset.rest) || 0));
    }
  }
  if (el.lastElementChild !== count) el.append(count);
  return count;
}

/** How many of marks this wide are shown in `room`, leaving `count` for the count, and how many are left: one at least is shown. */
export function fitCount(widths, room, count, gap = 0) {
  const whole = widths.reduce((a, w, i) => a + w + (i ? gap : 0), 0);
  if (whole <= room) return { shown: widths.length, rest: 0 };
  let shown = widths.length, used = whole;
  while (shown > 1 && used > room - count - gap) used -= widths[--shown] + gap;
  return { shown, rest: widths.length - shown };
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
  const css = getComputedStyle(el);
  // Measured whole: the first mark gives way only once the count is said, where it alone is wider than the box.
  el.dataset.measuring = '';
  const widths = kids.map((k) => k.getBoundingClientRect().width);
  delete el.dataset.measuring;
  const inner = room - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0);
  const { shown, rest } = fitCount(widths, inner, count.getBoundingClientRect().width, parseFloat(css.columnGap) || 0);
  kids.forEach((k, i) => (k.hidden = i >= shown));
  if (!rest) return void (count.hidden = true);
  count.textContent = `+${rest}`;
  count.dataset.rest = String(rest);
  const left = kids.filter((k) => k.hidden).map((k) => k.getAttribute('title') || k.textContent?.trim()).filter(Boolean);
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
