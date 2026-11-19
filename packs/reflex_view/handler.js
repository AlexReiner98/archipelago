// Reflex record, drawn. Answers the rows an instruction's page shows of its record: the record is the reflex_said
// pack's (the read said_record), the runs' names are read here, and rows.js makes the rows.

import { countsOf, rowsOf, RUNS_SHOWN } from './rows.js';

/** How many instructions one ask of their counts reads at most: the record's own limit. */
const MOST = 50;

export default {
  'reflex_view.said': async (input, ctx) => {
    const about = typeof input?.about === 'string' && input.about ? input.about : undefined;
    if (!about) return { answer: [] };
    const item = await ctx.read({ get: about });
    if (!item) return { answer: [] };
    const id = typeof item.props?.preset === 'string' ? item.props.preset : item.id;
    const [record] = await ctx.read({ said_record: { ids: [id] } });
    const ids = [...(record?.per_run ?? [])].sort((a, b) => b.said_at.localeCompare(a.said_at)).slice(0, RUNS_SHOWN).map((v) => v.run);
    const runs = ids.length ? await ctx.read({ ids }) : [];
    return { answer: rowsOf(item, record, Array.isArray(runs) ? runs : []) };
  },

  // What the tree's drawing asks through its sends: every miss lately, as the reflex_said pack reads them.
  'reflex_view.misses': async (input, ctx) => {
    const days = Number.isInteger(input?.days) ? input.days : undefined;
    const limit = Number.isInteger(input?.limit) ? input.limit : undefined;
    const found = await ctx.read({ misses: { ...(days !== undefined && { days }), ...(limit !== undefined && { limit }) } });
    return { answer: Array.isArray(found) ? found : [] };
  },

  // What the tree's drawing asks through its sends: every rule in force and when each fired.
  'reflex_view.rules': async (input, ctx) => {
    const days = Number.isInteger(input?.days) ? input.days : undefined;
    const found = await ctx.read({ said_rules: days === undefined ? {} : { days } });
    return { answer: Array.isArray(found) ? found : [] };
  },

  // What the tree's drawing asks through its sends: its story over a window, as the reflex_said pack tells it.
  'reflex_view.story': async (input, ctx) => {
    const ids = Array.isArray(input?.ids) ? input.ids.filter((id) => typeof id === 'string').slice(0, MOST) : [];
    const days = Number.isInteger(input?.days) ? input.days : undefined;
    return { answer: await ctx.read({ said_story: { ids, ...(days !== undefined && { days }) } }) };
  },

  // What the tree's drawing asks through its sends: each node's counts, by the id its item is said under.
  'reflex_view.said_counts': async (input, ctx) => {
    const asked = Array.isArray(input?.ids) ? [...new Set(input.ids.filter((id) => typeof id === 'string' && id))].slice(0, MOST) : [];
    if (!asked.length) return { answer: [] };
    const items = await ctx.read({ ids: asked.filter((id) => id.startsWith('e_')) });
    return { answer: await countsOf(asked, Array.isArray(items) ? items : [], (ids) => ctx.read({ said_record: { ids } })) };
  },
};
