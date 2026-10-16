// The demo pack's handler: run in its own sandboxed process by the pack host.
import { readFileSync } from 'node:fs';

export default {
  // Reads the task it is given, and answers a visit that is part of it.
  async 'demo.plan_visit'(input, ctx) {
    const task = await ctx.read({ get: input.task });
    if (!task) throw new Error(`No task ${input.task}`);
    const same = await ctx.read({ items: { type: 'demo.visit', where: { site: input.site } } });
    return {
      ops: [
        { op: 'create', ref: 'v', type: 'demo.visit', title: `Visit ${input.site}`, props: { site: input.site } },
        { op: 'link', type: 'part_of', from: 'v', to: task.id },
      ],
      answer: { earlier: same.length, by: ctx.actor.name },
      reason: `Plan a visit to ${input.site} for "${task.title}"`,
    };
  },
  // The visits planned to a site.
  async 'demo.visits'(input, ctx) {
    const visits = await ctx.read({ items: { type: 'demo.visit', where: { site: input.site } } });
    return { answer: visits.map((v) => v.title) };
  },
  // Reads the price list, then asks to buy (held: it moves money) and to leave a note (made at once).
  async 'demo.order'(input) {
    return {
      ops: [{ op: 'create', type: 'task', title: `Order ${input.item}` }],
      requests: [
        { host: 'shop', path: 'prices', then: 'demo.priced' },
        { host: 'shop', path: 'orders', body: { item: input.item }, act: 'buy', then: 'demo.bought' },
        { host: 'shop', path: 'notes', body: { text: `ordering ${input.item}` }, act: 'note' },
        ...(input.peek ? [{ host: input.peek, path: 'x' }] : []),
      ],
    };
  },
  // Told the price list: records it.
  async 'demo.priced'(input) {
    return { ops: [{ op: 'create', type: 'note', title: `Prices: ${Object.keys(input.body).join(', ')}` }] };
  },
  // Told the order went through.
  async 'demo.bought'(input) {
    return { ops: [{ op: 'create', type: 'note', title: `Bought, order ${input.body.order}` }] };
  },
  // A delivery came in from outside.
  async 'demo.delivered'(input) {
    return { ops: [{ op: 'create', type: 'note', title: `Delivered: ${input.payload.item}` }] };
  },
  // Runs by itself: reads the prices.
  async 'demo.tick'() {
    return { requests: [{ host: 'shop', path: 'prices', then: 'demo.priced' }] };
  },
  // Never ends.
  async 'demo.spin'() {
    for (;;);
  },
  // Tries to read what is outside its folder.
  async 'demo.peek'() {
    return { answer: readFileSync(new URL('../../../package.json', import.meta.url), 'utf8').slice(0, 20) };
  },
  // Says what of the environment it was given.
  async 'demo.env'() {
    return { answer: Object.keys(process.env) };
  },
};
