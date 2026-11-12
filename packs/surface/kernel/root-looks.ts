// The root service root.look (docs/kernel-packs.md, "Root services"): what the looks pack (packs/look_draw) needs of
// the roots to draw a view for an agent, and no more. The version of the UI's files a kept picture was drawn from
// (./ui-files.ts), a look pass for the screen of the map that calls (walls, look-pass.ts: kept in the whole
// workspace's transient store), and how many looks the workspace may have in an hour (rules, standing.ts).

import type { RootCall } from '../../loader/kernel/root-calls.ts';
import { bypassingRls } from '../../walls/kernel/outbox.ts';
import { passFor } from '../../walls/kernel/look-pass.ts';
import { looksAllowed, overLimit } from '../../rules/kernel/standing.ts';
import { uiVersion } from './ui-files.ts';

/** One of: the UI's version, a pass for `actor` on the calling map's screen, or the room for one more look after `had` this hour. */
export type LookAsk = { ui: true } | { pass: { actor: string } } | { room: { had: number; otherwise: number } };

export async function lookOf(call: RootCall, ask: LookAsk): Promise<unknown> {
  const map = call.map;
  if (!map) throw new Error('root.look is asked from a map');
  if ('ui' in ask) return { ui: await uiVersion() };
  if ('pass' in ask) {
    if (typeof ask.pass?.actor !== 'string') throw new Error('root.look mints a pass for an actor');
    return { pass: await passFor((await bypassingRls(map)).db, map, ask.pass.actor) };
  }
  if ('room' in ask) {
    const { had, otherwise } = ask.room;
    if (!Number.isInteger(had) || !Number.isInteger(otherwise)) throw new Error('root.look counts looks in whole numbers');
    const { most, limits } = await looksAllowed(map.workspace, otherwise);
    // The refusal names the workspace's plan when it has limits; with none, the looks pack says it in its own words.
    return { most, ...(had >= most && limits && { refused: (await overLimit(map.workspace, limits, 'looks', had, 'read one again with query picture, or wait')).message }) };
  }
  throw new Error('root.look answers ui, pass or room');
}
