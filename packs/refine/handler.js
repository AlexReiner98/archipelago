// The refine pack's handler: run in its own sandboxed process by the kernel's pack host. Its view reads the map
// through ctx.read and writes nothing; the kernel's query tool answers it by its short name (snags). Its replay
// actions hold finished tasks' briefs on a replay set (the replays pack's types) and ask the kernel to start them again.

import { freezeAnswer, replayAnswer } from './replay.js';
import { snagsOf, touchesOf } from './snags.js';

/** The fields of a snag the view reads. */
const FIELDS = ['touches', 'severity'];

/** The open snags: inside `within` at any depth, or else those of the types that name what they touched. */
async function openSnags(input, ctx) {
  const types = Array.isArray(input.types) && input.types.length ? input.types : ['issue'];
  if (input.within) return ctx.read({ scope: input.within, parts: true, open: true, types, fields: FIELDS });
  const found = [];
  for (const type of types) {
    const info = await ctx.read({ type_info: type });
    if (!info) continue;
    found.push(...(await ctx.read({ items: { type, status: info.statuses.open }, fields: FIELDS })).filter((s) => touchesOf(s.props?.touches).length));
  }
  return found;
}

async function snags(input, ctx) {
  const open = (await openSnags(input, ctx)).filter((s) => s.id !== input.within);
  const writers = open.length ? await ctx.read({ writers: open.map((s) => s.id) }) : [];
  const answer = snagsOf(
    open.map((s) => ({ id: s.id, title: s.title, type: s.type, status: s.status, severity: s.props?.severity, touches: s.props?.touches })),
    writers.map((w) => ({ snag: w.item, id: w.run, title: w.title, packs: w.packs })),
  );
  return { ...(input.within && { within: input.within }), ...answer };
}

/** A replay set and its held briefs, whole (their notes are the briefs), or a refusal when id is no set. */
async function setOf(id, ctx) {
  const set = await ctx.read({ get: id });
  if (!set || !(set.is ?? []).includes('replays.set')) throw new Error(`"${id}" is not a replay set.`);
  const briefs = await ctx.read({ related: id, relation: 'part_of', direction: 'in', types: ['replays.brief'] });
  return { set, briefs };
}

async function freeze(input, ctx) {
  const { set, briefs } = input.set ? await setOf(input.set, ctx) : { set: null, briefs: [] };
  const asked = [];
  for (const id of input.tasks ?? []) {
    if (briefs.some((b) => b.props?.task === id)) continue;
    const task = await ctx.read({ get: id });
    asked.push({ id, task, brief: task ? await ctx.read({ view: 'brief', params: { task: id } }) : null });
  }
  return freezeAnswer({ set, title: input.title, held: briefs, asked, now: ctx.now });
}

async function replay(input, ctx) {
  const { set, briefs } = await setOf(input.set, ctx);
  return replayAnswer({ set, briefs, version: input.version, packs: await ctx.read({ packs: true }), mode: input.mode, instructions: input.instructions });
}

export default {
  'refine.snags': async (input, ctx) => ({ answer: await snags(input ?? {}, ctx) }),
  'refine.replay_freeze': (input, ctx) => freeze(input ?? {}, ctx),
  'refine.replay': (input, ctx) => replay(input ?? {}, ctx),
};
