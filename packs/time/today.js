// Today, as rows for Home: the owner's blocks today, in the order they fall, and how much planned time waits to be
// confirmed. Read off the week, so the two never disagree.

import { today } from './days.js';
import { week } from './week.js';

/** An hour of the day as 9:30. */
const clock = (hour) => `${Math.floor(hour)}:${String(Math.round((hour % 1) * 60)).padStart(2, '0')}`;

export async function todayRows(input, ctx) {
  const wk = await week({}, ctx);
  const day = wk.days.find((d) => d.date === today(ctx.zone, Date.parse(ctx.now)));
  const blocks = [...(day?.owner ?? [])].sort((a, b) => (a.from_hour ?? 99) - (b.from_hour ?? 99));
  const rows = blocks.map((b) => ({
    id: b.id,
    type: b.routine ? 'time.routine' : 'time.entry',
    title: `${b.from_hour === null ? `${b.hours} h` : `${clock(b.from_hour)}–${clock(b.to_hour)}`} ${b.what}${b.work && b.work !== b.what ? ` · ${b.work}` : ''}`,
    ...(!b.routine && { status: b.status }),
  }));
  if (wk.to_confirm.length) rows.push(`${wk.to_confirm.length} to confirm on Time`);
  return rows;
}
