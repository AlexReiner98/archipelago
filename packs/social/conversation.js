// A conversation a post began: someone who replied or wrote and said the problem they have. It is made from the post's
// page in one step, linked came_out_of the post (or the source it came through), and the post's count of conversations
// is read again from those links each time, so it is the number of conversations that say they came from it.

const isA = (item, type) => Boolean(item?.is?.includes(type));
/** The longest title the server takes from an agent. */
const TITLE = 60;

/** The day it is in a time zone, as 2026-11-04. */
const dayIn = (zone, now) => new Intl.DateTimeFormat('en-CA', { timeZone: zone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now ?? Date.now()));

/** A name of a few words: the person and the problem, cut where it would run past the limit. */
export function titleOf(person, problem) {
  const whole = `${person}: ${problem}`.replace(/\s+/g, ' ').trim();
  return whole.length <= TITLE ? whole : `${whole.slice(0, TITLE - 1).trimEnd()}…`;
}

export async function conversation(input, ctx) {
  const person = String(input.person ?? '').trim();
  const problem = String(input.problem ?? '').trim();
  if (!person || !problem) throw new Error('A conversation names the person and the problem they said.');
  const from = input.from ? await ctx.read({ get: input.from }) : null;
  if (!from || from.archived_at || !(isA(from, 'post') || isA(from, 'channel'))) throw new Error(`No post or source "${input.from}" for the conversation to have come from: give its id.`);
  const channel = input.channel ?? from.props?.channel;
  const began = input.date ?? dayIn(ctx.zone, ctx.now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(began)) throw new Error('date must look like 2026-11-04');
  const before = await ctx.read({ related: from.id, relation: 'came_out_of', direction: 'in', types: ['conversation'] });
  const n = before.length + 1;
  const counted = isA(from, 'post');
  return {
    ops: [
      { op: 'create', ref: 'c', type: 'conversation', title: titleOf(person, problem), status: 'open', body: input.note ?? '', props: { person, problem, began, ...(channel && { channel }) } },
      { op: 'link', type: 'came_out_of', from: 'c', to: from.id },
      ...(counted ? [{ op: 'update', id: from.id, props: { conversations: n } }] : []),
    ],
    reason: `A conversation with ${person}, from ${from.title}`,
    answer: { conversation: titleOf(person, problem), from: from.title, ...(counted && { conversations: n }) },
  };
}
