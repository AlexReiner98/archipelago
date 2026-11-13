// The catch_up pack's part catch_up.changes, on the trace overlay over a canvas (the slot `traces`). The runtime hands
// it each beat of the log as data, the rows the beat touched as they were and are (`beat`), and says when a traced
// mark was seen (`seen`); it answers with a trace mark for each item that waits. What waits is kept between pages
// (tools.keep), so a reload keeps a trace not yet seen and does not bring back one that was.

import { changeSet } from './changes.js';
import { keptOf, sawIt, trace, traceBook, traceMarks } from './traces.js';

/** How long seen keys are kept, in days, where the style says nothing. */
const KEPT_DAYS = 30;

export default function traced(input, tools) {
  let now = input;
  const book = traceBook(input?.kept?.traces);
  const days = () => now?.style?.numbers?.trace_kept_days ?? KEPT_DAYS;
  const draw = () => ['box', { key: 'traces' }, ...traceMarks(book)];
  const keep = () => tools?.keep?.(keptOf(book, Date.now(), days()), 'traces');
  // A part mounted after the runtime told the slot hears the last beat it told as `told` (hooks.tellSlot).
  if (input?.told?.name === 'beat' && Array.isArray(input.told.rows) && trace(book, changeSet(input.told), input.piece?.me ?? input.me)) keep();
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    on(event) {
      if (event?.name === 'beat' && Array.isArray(event.rows)) {
        if (!trace(book, changeSet(event), now?.piece?.me ?? now?.me)) return undefined;
        keep();
        return draw();
      }
      if (event?.name === 'seen' && typeof event.item === 'string') {
        if (!sawIt(book, event.item, Date.now())) return undefined;
        keep();
        return draw();
      }
      return undefined;
    },
  };
}
