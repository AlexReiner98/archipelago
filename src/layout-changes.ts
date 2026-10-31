// A change a drawing asked for. A style's code never writes: it says what it wants as ops, and the page sends them as
// the person looking, naming the style whose code asked (decision e_h7he5guk, "A drawing asks in data; the page acts
// as the person"). The rules then read the change as the drawing's (core's drawing_* rules): what it writes to the
// types its style declares (`writes`) applies, anything else waits for that person, even though it is theirs.

import type { Actor, Archipelago, ChangeInput } from './pelago.ts';

/** What a drawing may ask for: never a merge, a type, or a forget. */
export const DRAWING_OPS = ['create', 'update', 'link', 'unlink', 'archive', 'restore'];

/** The drawing a change was asked by, as the rules read it (`Who.drawing`); nothing when no drawing asked. */
export async function layoutOf(l: Archipelago, actor: Actor, input: ChangeInput): Promise<{ drawing?: { style: string; writes: string[] } }> {
  if (input.drawing === undefined) return {};
  const no = (why: string) => new Error(`Change rejected:\n- ${why}`);
  if (actor.kind !== 'human') throw no('A change a drawing asked for is sent by the page, as the person looking at it.');
  const style = await l.entity(input.drawing);
  if (!style || !l.registry.isA(style.type, 'style') || !(typeof style.props.code === 'string' || style.props.modules)) throw no(`"${input.drawing}" is no style with code of its own, so no drawing of it can ask for a change.`);
  const odd = input.ops.filter((o) => !DRAWING_OPS.includes(o.op)).map((o) => o.op);
  if (odd.length) throw no(`A drawing may ask to ${DRAWING_OPS.join(', ')}; not to ${[...new Set(odd)].join(', ')}.`);
  const writes = Array.isArray(style.props.writes) ? style.props.writes.map(String) : [];
  return { drawing: { style: style.id, writes } };
}
