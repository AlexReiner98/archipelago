// Two fingers on a picture: from the moment the second lands until the last is lifted, the fingers belong to the plane.
// Nothing under them sees them move, so a mark one finger began on neither moves nor opens, and the finger left after
// the other lifts does not go on to drag. Only touch: a mouse has one pointer and a wheel.

/**
 * Follow pinches on `frame`. `begin(middle)` says two fingers stand at a start, `pinch(scale, middle)` where they stand
 * now: `scale` their distance over what it was at the start, `middle` the point of the frame between them, as [x, y].
 */
export function pinchOf(frame, { begin, pinch }) {
  const fingers = new Map();
  let held = false, from = 1;
  const two = () => [...fingers.values()].slice(0, 2);
  const spread = ([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const between = ([a, b]) => {
    const r = frame.getBoundingClientRect();
    return [(a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top];
  };
  const start = () => ((from = spread(two())), begin(between(two())));
  frame.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'touch') return;
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size < 2) return;
      e.stopPropagation();
      held = true;
      // Held, so a finger that leaves the frame or the mark it began on still counts.
      for (const id of fingers.keys()) {
        try {
          frame.setPointerCapture(id);
        } catch {}
      }
      start();
    },
    { capture: true },
  );
  frame.addEventListener(
    'pointermove',
    (e) => {
      const finger = fingers.get(e.pointerId);
      if (!finger) return;
      finger.x = e.clientX;
      finger.y = e.clientY;
      if (!held) return;
      e.stopPropagation();
      if (fingers.size >= 2) pinch(spread(two()) / from, between(two()));
    },
    { capture: true },
  );
  // One finger left waits to be lifted, or for a second to start afresh from where they stand.
  const lifted = (e) => {
    if (!fingers.delete(e.pointerId)) return;
    if (!fingers.size) held = false;
    else if (fingers.size >= 2) start();
  };
  frame.addEventListener('pointerup', lifted, { capture: true });
  frame.addEventListener('pointercancel', lifted, { capture: true });
}
