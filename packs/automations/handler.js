// Automations. Told by the kernel's clock that an item came due (packs/clocks/kernel/due.ts), it reads the item and, when it is an
// enabled automation, what it is about, and answers what it does: a notification, or a launch the kernel starts
// (packs/loader/kernel/pack-launch.ts), with the fact of its firing (firing.js). The kernel only keeps time; this pack acts.
// It also answers the rows automations are drawn as: those about an item, or all of them, where each falls next by
// the kernel's clock, and its last firing; rows.js makes the rows.

import { answerDue, fires } from './fire.js';
import { failedFiring, withFiring } from './firing.js';
import { rowsOf, windowFrom } from './rows.js';

const FIELDS = ['action', 'at', 'days', 'last_fired', 'last_result'];
/** How many automations a page shows at most. */
const MOST = 200;

export default {
  'item.due': async ({ event }, ctx) => {
    const id = event?.target;
    if (typeof id !== 'string' || !id) return {};
    const item = await ctx.read({ get: id });
    if (!item || !(item.is ?? []).includes('automation')) return {};
    try {
      const about = fires(item) ? await ctx.read({ related: id, relation: 'about', direction: 'out' }) : [];
      // One that launches starts nothing while the session it last started is open.
      const last = fires(item) && item.props?.action === 'launch' && typeof item.props.last_run === 'string' ? await ctx.read({ get: item.props.last_run }) : null;
      return withFiring(item, event, answerDue(item, Array.isArray(about) ? about[0]?.id : undefined, Boolean(last?.is_open)));
    } catch (err) {
      return failedFiring(item, event, err);
    }
  },

  'automations.rows': async (input, ctx) => {
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
