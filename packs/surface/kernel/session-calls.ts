// What the surface asks of the sessions pack: a session's acts (session_start, session_update, tell, session_end and
// the rest), which answer on every map whether or not it has sessions on, as they did before sessions became an
// optional pack. Each is the pack's filling of the loader's slot loader.calls (packs/loader/kernel/own-calls.ts),
// called by its name on the pack's own context of the map: the surface imports none of its code.

import { ownCall } from '../../loader/kernel/own-calls.ts';
import type { Actor, Archipelago, Entity } from '../../../src/pelago.ts';
import type * as S from '../../sessions/kernel/sessions.ts';

type Rest<F> = F extends (ctx: never, ...rest: infer R) => unknown ? R : never;
type Out<F> = F extends (...args: never[]) => infer O ? Awaited<O> : never;
/** One of the pack's acts, by its name, as the map calls it. */
const act = <K extends 'sessionStart' | 'sessionUpdate' | 'sessionEnd' | 'tell' | 'recordRun' | 'importAudit'>(name: K) =>
  (l: Archipelago, actor: Actor, input: Rest<(typeof S)[K]>[1]) => ownCall<Out<(typeof S)[K]>>(l, name, actor, input);

export const sessionStart = act('sessionStart');
export const sessionUpdate = act('sessionUpdate');
export const sessionEnd = act('sessionEnd');
export const tell = act('tell');
export const recordRun = act('recordRun');
export const importAudit = act('importAudit');
export const recordUsage = (l: Archipelago, ...rest: Rest<typeof S.recordUsage>) => ownCall<Out<typeof S.recordUsage>>(l, 'recordUsage', ...rest);
export const resolveRun = async (l: Archipelago, key: string, openOnly = false) => (await ownCall<Out<typeof S.resolveRun>>(l, 'resolveRun', key, openOnly)) as Entity | undefined;
export const closeOffers = (l: Archipelago, ...rest: Rest<typeof S.closeOffers>) => ownCall<Out<typeof S.closeOffers>>(l, 'closeOffers', ...rest);
export const sessionsAwake = (l: Archipelago) => ownCall<number>(l, 'sessionsAwake');
