// How tall a field of words is drawn (packs/walls/page/part-render.js): one line, or a box of lines that grows with
// them. A title wraps to the lines it needs rather than being cut, and stays one line of words however it wraps.

/** Whether a field is a title that wraps: one line of words, drawn as a box that grows. */
export const wraps = (at) => at?.look === 'title' && (at.kind ?? 'text') === 'text';

/** Whether a field is drawn as a box of lines: asked for more than one, or a title that wraps. */
export const boxOfLines = (at) => (at.lines ?? 1) > 1 || wraps(at);

/** A line break pasted into a title is a space. */
export const oneLine = (el, at) => wraps(at) && /\n/.test(el.value) && (el.value = el.value.replace(/\s*\n\s*/g, ' '));

/** A box of lines that fits its words is as tall as they are; the scroll it sits in is kept still while it is measured. */
export function fit(el, at) {
  if (el.tagName !== 'TEXTAREA' || !at?.fits) return;
  const scroller = el.closest('#sheet') ?? document.scrollingElement;
  const top = scroller?.scrollTop;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
  if (scroller) scroller.scrollTop = top;
}
