// The tests' server pack: a request kept, a signed webhook that makes a workspace and its admin, and a poll that
// answers a sign-in link once. And three calls that must be refused. What a workspace it made may do (its limits,
// whether it has ended) it keeps in its store and says at its gate standing, which only the kernel calls.
export default {
  async start(input, ctx) {
    await ctx.store.put(`request:${input.request}`, { email: input.email, name: input.name }, 60_000);
    return { answer: { kept: input.request } };
  },
  async paid(body, ctx) {
    const request = await ctx.store.get(`request:${body.request}`);
    const { workspace } = await ctx.act('workspace.create', { name: request.name, email: request.email });
    await ctx.act('workspace.admit', { workspace: workspace.id, email: request.email, admin: true });
    await ctx.store.put(`made:${body.request}`, { workspace: workspace.id, email: request.email });
    return { answer: { workspace: workspace.id } };
  },
  async poll(input, ctx) {
    const made = await ctx.store.take(`made:${input.request}`);
    if (!made) return { answer: { state: 'waiting' } };
    return { answer: { state: 'ready', ...(await ctx.act('signin.link', { workspace: made.workspace, email: made.email })) } };
  },
  sneak: (_input, ctx) => ctx.act('mail.send', { to: 'someone@example.com', subject: 'x', text: 'x' }),
  peek: (_input, ctx) => ctx.read({ items: { type: 'person' } }),
  listed: async (input, ctx) => ({ answer: await ctx.store.list(input.prefix, input.most) }),
  async limit({ workspace, ...limits }, ctx) {
    await ctx.store.put(`limits:${workspace}`, limits);
    return { answer: { workspace } };
  },
  async end({ workspace, ended, days = 30, note }, ctx) {
    if (ended === false) {
      await ctx.store.take(`ended:${workspace}`);
      return { answer: { workspace, ended: false } };
    }
    const since = new Date(ctx.now);
    const delete_at = new Date(since.getTime() + days * 86_400_000).toISOString();
    await ctx.store.put(`ended:${workspace}`, { since: since.toISOString(), delete_at, note });
    return { answer: { workspace, ended: true, delete_at } };
  },
  standing: async ({ workspace }, ctx) => ({ answer: { limits: await ctx.store.get(`limits:${workspace}`), ended: await ctx.store.get(`ended:${workspace}`) } }),
  elsewhere: (_input, ctx) => ctx.act('workspace.admit', { workspace: 'default', email: 'intruder@example.com', admin: true }),
};
