// Reflex record, drawn. Answers the rows an instruction's page shows of its record: the record is the reflex_said
// pack's (the read said_record), the runs' names are read here, and rows.js makes the rows.

import { rowsOf, RUNS_SHOWN } from './rows.js';

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
};
