// A seller for test/guest-keep.test.ts: its gate kept begins a trial on the kept map, or, for an address or a machine
// that had one, ends it at once with the way to pay; its gate standing says which.
const DAY = 86_400_000;
export default {
  async kept({ workspace, email, machine }, ctx) {
    const key = `email:${email.replace(/[^\w.-]/g, '_')}`;
    const had = (await ctx.store.get(key)) || (machine && (await ctx.store.get(`machine:${machine}`)));
    await ctx.store.put(key, true);
    if (machine) await ctx.store.put(`machine:${machine}`, true);
    if (had) {
      const since = Date.parse(ctx.now);
      await ctx.store.put(`ended:${workspace}`, { since: new Date(since).toISOString(), delete_at: new Date(since + 30 * DAY).toISOString(), note: 'Choose a plan.' });
      return { answer: { upgrade: '/x/seller/upgrade' } };
    }
    const ends = new Date(Date.parse(ctx.now) + 30 * DAY).toISOString();
    await ctx.store.put(`limits:${workspace}`, { members: 5, note: 'A trial.' });
    return { answer: { trial: { ends } } };
  },
  peek: async ({ key }, ctx) => ({ answer: await ctx.store.get(key) }),
  standing: async ({ workspace }, ctx) => ({ answer: { limits: await ctx.store.get(`limits:${workspace}`), ended: await ctx.store.get(`ended:${workspace}`) } }),
};
