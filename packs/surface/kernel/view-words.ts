// What the surface says of the views (the tool list, the view tool's words, what a client is told on connecting): the
// query pack's words, its filling of the server slot surface.views (./server-fillings.ts), read once before anything is
// called, so a description is made without asking a map. A view itself is asked by its name, answer.ask_view (askView).

import type { Actor, Archipelago } from '../../../src/pelago.ts';
import { serverFillings } from './server-fillings.ts';
import type { words } from '../../query/kernel/askview.ts';

const filled = await serverFillings<ReturnType<typeof words>>('surface.views');
if (filled.length !== 1) throw new Error(`surface.views takes one filling: ${filled.length ? filled.map((f) => f.pack).join(' and ') : 'no pack of this server'} fills it`);

const { names, list, said } = filled[0].filled;
/** The name of every question that can be asked here, the flat lens first. */
export const viewNames = names;
/** Every question that can be asked here, with what each answers. */
export const viewList = list;
/** What the view tool says it answers. */
export const viewsSaid = said;

/** A question answered by its name, as the one who asked: the query pack's answer.ask_view. */
export const askView = async (l: Archipelago, actor: Actor, name: string, params: Record<string, unknown> = {}) =>
  (await import('../../loader/kernel/kernel-context.ts')).callAs(l, 'answer.ask_view', { actor, name, params });
