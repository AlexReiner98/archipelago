// Automations: told by the kernel's clock that an item came due (src/due.ts), it reads the item and, when it is an
// enabled automation, what it is about, and answers what it does: a notification, or a launch the kernel starts
// (src/pack-launch.ts), with the fact of its firing (firing.js). The kernel only keeps time; this pack acts.

import { answerDue, fires } from './fire.js';
import { failedFiring, withFiring } from './firing.js';

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
};
