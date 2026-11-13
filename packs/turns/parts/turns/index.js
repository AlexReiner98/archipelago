// A session's turns on its page, as the turns pack's part (task e_nbghm8wb): one line a turn, newest first, the beats
// the session told placed among them at their times. A press folds a turn open; an open turn carries the press that
// follows it up (the pack's action turns.follow_up, sent through the host's bridge as the person's). It is handed the
// run and the two reads it declares (pack.json: the views turns and story), and answers with marks alone.

import { beatRow, toFollow, turnKey, turnRow } from './rows.js';

/** The rows along time, newest first: each turn and each beat at its time. */
function along(input) {
  const turns = input?.views?.turns?.turns ?? [];
  const beats = input?.views?.story?.beats ?? [];
  const rows = [...turns.map((t) => ({ at: t.began, turn: t })), ...beats.map((b) => ({ at: b.at, beat: b }))];
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** The marks for what it was handed and what is open. */
function marks(input, seen) {
  const rows = along(input);
  if (!rows.length) return ['text', { look: 'muted' }, 'No turns yet'];
  const names = input.views?.turns?.names ?? {};
  const more = input.views?.turns?.more ?? 0;
  return [
    'list',
    { look: 'rows' },
    ...rows.map((r) => (r.turn ? turnRow(r.turn, { names, open: seen.open.has(turnKey(r.turn)), following: seen.following, followed: seen.followed }) : beatRow(r.beat))),
    ...(more > 0 ? [['text', { look: 'muted', size: 2 }, `${more} older`]] : []),
  ];
}

export default function turns(input, tools) {
  let now = input;
  const seen = { open: new Set(), following: undefined, followed: {} };
  const draw = () => marks(now, seen);
  const turnBy = (key) => (now?.views?.turns?.turns ?? []).find((t) => turnKey(t) === key);
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    async on(event) {
      if (event?.name !== 'press' || typeof event.key !== 'string') return undefined;
      if (event.key.startsWith('turn:') && turnBy(event.key)) {
        seen.open.has(event.key) ? seen.open.delete(event.key) : seen.open.add(event.key);
        return draw();
      }
      const key = /^follow:(turn:.+)$/.exec(event.key)?.[1];
      const t = key && turnBy(key);
      if (!t || !now?.item?.id || seen.following) return undefined;
      seen.following = key;
      tools.marks(draw());
      const said = await tools.act('turns.follow_up', { run: now.item.id, said: toFollow(t), at: t.began });
      seen.following = undefined;
      seen.followed[key] = said?.error ? { error: String(said.error) } : { said: said?.proposal ? 'waiting for the owner' : 'a task' };
      return draw();
    },
  };
}
