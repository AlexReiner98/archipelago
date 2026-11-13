// The turns pack's handler, run in its own sandboxed process by the kernel's pack host. Its one action, turns.follow_up,
// makes a task of a session's turn: what the turn asked (or did), as work on the map about the session, part of the
// work the session was on (so it stands where that work stands, on its island). A turn that ends asking leaves something
// to do, and before this it was left only in the chat. It reads the run and what it works on, and answers with the ops;
// whether the change applies or waits is the rules' to say.

/** How long a title may be: a name is a few words. */
const TITLE_MOST = 60;

/** A title from what a turn said: its first clause, cut at a word to sixty characters. */
export function titleOf(said) {
  const first = String(said ?? '').trim().split(/(?<=[?.!])\s|\n/)[0].trim();
  if (first.length <= TITLE_MOST) return first;
  const cut = first.slice(0, TITLE_MOST - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 30 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`;
}

/**
 * The ops that follow up a turn of `run`: a task, its note the whole of what the turn said, about the run, and part of
 * `work` (what the run works on, newest first) when it is on any; else on the run's own island, or the island of the
 * place it lives in (`places`, its repository), when one names one.
 */
export function followUp(run, { said, at } = {}, work = [], places = []) {
  if (!run || !(run.type === 'run' || (run.is ?? []).includes('run'))) throw new Error('That is not a session.');
  const text = String(said ?? '').trim();
  if (!text) throw new Error('A turn with nothing said has nothing to follow up.');
  const title = titleOf(text);
  const when = typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at.slice(0, 16).replace('T', ' ') : undefined;
  const body = `${text.slice(0, 2000)}\n\n## From\nA turn of [${String(run.title ?? 'a session').slice(0, 80)}](${run.id})${when ? `, ${when}` : ''}.`;
  const under = work.find((w) => typeof w?.id === 'string');
  const island = [run, ...places].map((p) => p?.props?.island).find((i) => typeof i === 'string');
  return {
    ops: [
      { op: 'create', ref: 'task', type: 'task', title, body, status: 'todo', ...(!under && typeof island === 'string' && { props: { island } }) },
      { op: 'link', type: 'about', from: 'task', to: run.id },
      ...(under ? [{ op: 'link', type: 'part_of', from: 'task', to: under.id }] : []),
    ],
    reason: `Follow up a turn of "${String(run.title ?? '').slice(0, 60)}": ${title}`,
    answer: { run: run.id, title, ...(under && { under: under.id }) },
  };
}

export default {
  'turns.follow_up': async (input, ctx) => {
    const id = String(input?.run ?? '');
    const run = await ctx.read({ get: id });
    const list = async (relation) => (run ? await ctx.read({ related: id, relation, direction: 'out', newest: 'updated' }) : []);
    const [work, places] = [await list('works_on'), await list('lives_in')];
    return followUp(run, input, Array.isArray(work) ? work : [], Array.isArray(places) ? places : []);
  },
};
