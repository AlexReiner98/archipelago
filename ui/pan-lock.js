// A pan that goes on past the pane's edge. A page cannot move the real cursor, so a pan already under way locks the
// pointer to its frame and draws one of its own (`.pan-cursor`, the style's), which comes round to the far edge when it
// leaves the frame. Everything is asked of the browser and nothing rests on its answer: until it says the pointer is
// locked the pan goes on as it was, and if it never does (refused, unsupported, just after an Esc) that is the whole of
// it. The browser gives the real cursor back where the lock began; a page has no say in that.

import { h } from './base.js';

/** What one of the page's pixels is in a locked pointer's movement: Chrome on Windows says it in the screen's own. */
const moved = () => (navigator.userAgentData?.platform === 'Windows' ? devicePixelRatio : 1);

/**
 * Ask for the pointer to be locked to `frame`, from where `start` (a pointer event) is. `lost()` is told when the lock
 * goes by anything but `end`: Esc, the window left, the frame taken off the page.
 * Answers with: whether it is `held`, `move(ev)` for a move while it is (it answers how far, in the page's pixels),
 * `at()` the drawn cursor's place in the frame, and `end()`.
 */
export function panLock(frame, start, lost) {
  const rect = frame.getBoundingClientRect();
  const place = { x: start.clientX - rect.left, y: start.clientY - rect.top };
  let cursor = null, ended = false;
  const held = () => document.pointerLockElement === frame;
  const draw = () => {
    const now = frame.getBoundingClientRect();
    cursor.style.left = `${now.left + place.x}px`;
    cursor.style.top = `${now.top + place.y}px`;
  };
  const stop = () => {
    document.removeEventListener('pointerlockchange', changed);
    document.removeEventListener('pointerlockerror', stop);
  };
  // An end that came before the browser answered lets go of the lock it then gives.
  function changed() {
    if (ended) return (stop(), held() && document.exitPointerLock());
    if (held()) {
      cursor = h('div', { class: 'pan-cursor', popover: 'manual' });
      frame.append(cursor);
      cursor.showPopover();
      return draw();
    }
    if (cursor) (end(), lost());
  }
  function end() {
    ended = true;
    cursor?.remove();
    const had = cursor;
    cursor = null;
    // Asked and not answered, it stays to hear the answer.
    if (had || !frame.requestPointerLock) stop();
    if (held()) document.exitPointerLock();
  }
  document.addEventListener('pointerlockchange', changed);
  document.addEventListener('pointerlockerror', stop);
  try {
    Promise.resolve(frame.requestPointerLock?.()).catch(() => {});
  } catch {}
  return {
    held: () => Boolean(cursor),
    move(ev) {
      const wrap = (at, most) => ((at % most) + most) % most;
      const dx = ev.movementX / moved(), dy = ev.movementY / moved();
      place.x = wrap(place.x + dx, Math.max(1, frame.clientWidth));
      place.y = wrap(place.y + dy, Math.max(1, frame.clientHeight));
      draw();
      return [dx, dy];
    },
    at: () => (cursor ? [place.x, place.y] : null),
    end,
  };
}
