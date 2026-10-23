// A page drawn again in place: what is new is laid over what is on the page, and only what differs is swapped. A
// part that is the same is the very node that was there, so its scroll, its open folds, the focus in it and a picture
// playing in it stay as they were. A picture whose lens is unchanged comes as a mark (`data-keep`, from lensView):
// the picture on the page is kept and asks for its answer again, drawing anew only if that answer changed.

/** Whether the form fields in a and b say the same: a field's value is not in its markup. */
const fieldsAgree = (a, b) => {
  const read = (n) => [...n.querySelectorAll('select, input, textarea')].map((f) => `${f.value}\n${f.checked}`).join('\n');
  return !a.querySelector || read(a) === read(b);
};
const holdsMark = (n) => n.nodeType === 1 && (n.dataset.keep !== undefined || n.querySelector('[data-keep]'));

/** Lay kids over what parent holds: each one the same as what is there is left as it was, the rest put in its place. */
export function settle(parent, kids) {
  const old = [...parent.childNodes];
  kids.forEach((k, i) => {
    const o = old[i];
    if (!o) return parent.append(k);
    if (k.nodeType === 1 && k.dataset.keep !== undefined && o.nodeType === 1 && o.dataset.lensKey === k.dataset.keep) return;
    if (o.isEqualNode(k) && fieldsAgree(o, k)) return;
    // What holds a kept picture is gone through: the picture stays where it is, what is around it is settled.
    if (holdsMark(k) && o.nodeType === 1 && o.tagName === k.tagName && o.className === k.className && !holdsMark(o)) {
      for (const name of o.getAttributeNames()) if (!k.hasAttribute(name) && name !== 'open') o.removeAttribute(name);
      for (const name of k.getAttributeNames()) if (name !== 'open') o.setAttribute(name, k.getAttribute(name));
      return settle(o, [...k.childNodes]);
    }
    swap(o, k);
  });
  for (const o of old.slice(kids.length)) o.remove();
}

/** Put k where o is, with the folds that were open in o open in k, and the focus where it was. */
function swap(o, k) {
  if (o.nodeType === 1 && k.nodeType === 1) {
    const open = new Set([...o.querySelectorAll('details[open] > summary')].map((s) => s.textContent));
    for (const s of k.querySelectorAll('details > summary')) if (open.has(s.textContent)) s.parentElement.open = true;
    const focused = document.activeElement;
    if (focused && focused !== document.body && o.contains(focused)) {
      const path = [];
      for (let n = focused; n !== o; n = n.parentElement) path.unshift([...n.parentElement.children].indexOf(n));
      o.replaceWith(k);
      let there = k;
      for (const i of path) there = there?.children[i];
      return void there?.focus?.({ preventScroll: true });
    }
  }
  o.replaceWith(k);
}

/**
 * Draw kids in place of what parent holds, once `fill` (what fetches the rest of them) has done: they wait out of
 * sight, in the page so what fills them finds them, while what is on screen stays. The ids and parts of what is on
 * screen are lent to what waits until then, so a lookup by id finds the new one.
 */
export async function settleWhenFilled(parent, kids, fill) {
  const waiting = document.createElement('div');
  waiting.setAttribute('aria-hidden', 'true');
  Object.assign(waiting.style, { position: 'absolute', visibility: 'hidden', pointerEvents: 'none', overflow: 'hidden', height: '0', width: `${parent.clientWidth}px` });
  waiting.append(...kids);
  const lent = [];
  for (const n of waiting.querySelectorAll('[id], [data-part]')) {
    const [name, value] = n.id ? ['id', n.id] : ['data-part', n.dataset.part];
    for (const o of parent.querySelectorAll(`[${name}="${CSS.escape(value)}"]`)) if (!waiting.contains(o)) (lent.push([o, name, value]), o.removeAttribute(name));
  }
  parent.append(waiting);
  try {
    // A piece that does not answer in a few seconds is drawn as it is by then.
    await Promise.race([fill?.(), new Promise((r) => setTimeout(r, 4000))]);
  } finally {
    for (const [o, name, value] of lent) o.setAttribute(name, value);
    waiting.remove();
  }
  settle(parent, [...waiting.childNodes]);
  // A mark that found no picture to keep (what holds it moved) is drawn as a picture of its own.
  for (const mark of parent.querySelectorAll('[data-keep]')) mark.replaceWith(mark.make());
}

/** Whether what is being drawn is drawn again in place: a picture asked for again then comes as a mark. */
export const drawing = { inPlace: false };
