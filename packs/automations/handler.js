// Automations: the rows they are drawn as. The handler reads the automations (those about an item, or all of them),
// where each falls next by the kernel's clock, and its last firing; rows.js makes the rows.

import { rowsOf, windowFrom } from './rows.js';

const FIELDS = ['action', 'at', 'days', 'last_fired', 'last_result'];
/** How many automations a page shows at most. */
const MOST = 200;

export default {
  rows: async (input, ctx) => {
    const about = typeof input?.about === 'string' && input.about ? input.about : undefined;
    const found = about
      ? await ctx.read({ related: about, relation: 'about', direction: 'in', types: ['automation'], fields: FIELDS })
      : await ctx.read({ items: { type: 'automation', status: ['enabled', 'paused'] }, fields: FIELDS });
    const items = (Array.isArray(found) ? found : []).filter((e) => e.status !== 'retired').slice(0, MOST);
    if (!items.length) return { answer: [] };
    const now = Date.parse(ctx.now);
    const placed = await ctx.read({ placed: { types: ['automation'], ...windowFrom(now, ctx.zone), by: ['when'] } });
    const spans = new Map((Array.isArray(placed) ? placed : []).map((e) => [e.id, e.time]));
    const fired = new Map(await Promise.all(items.map(async (e) => [e.id, await ctx.read({ events: { action: 'automation.fired', target: e.id, limit: 1 } })])));
    return { answer: rowsOf(items, { spans, fired, now, zone: ctx.zone }) };
  },
};
