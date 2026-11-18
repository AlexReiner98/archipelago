// A piece of a chat's row (./session-pieces.js): what it works on, named after its name in the chat's hue (the one its
// name gives it everywhere, sessionHue), the first and how many more; pointing at the row lights that work on the
// canvas (e_vr7tpgxp: who is on a task, seen where it stands).

import { sessionHue } from './words.js';

export default function on(s) {
  const work = Array.isArray(s.working_on) ? s.working_on.filter((w) => w?.id) : [];
  if (!work.length) return null;
  const said = `${work[0].title}${work.length > 1 ? ` + ${work.length - 1}` : ''}`;
  return { word: said, cls: 'isl-chat-on', tip: `on ${said}`, hue: sessionHue(s.name ?? s.title ?? ''), lights: work.map((w) => w.id) };
}
