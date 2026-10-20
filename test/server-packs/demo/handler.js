// The tests' server pack: a request kept, a signed webhook that makes a workspace and its admin, and a poll that
// answers a sign-in link once. And three calls that must be refused.
export default {
  async start(input, ctx) {
    await ctx.store.put(`request:${input.request}`, { email: input.email, name: input.name }, 60_000);
    return { answer: { kept: input.request } };
  },
  async paid(body, ctx) {
    const request = await ctx.store.get(`request:${body.request}`);
    const { workspace } = await ctx.act('workspace.create', { name: request.name });
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
  elsewhere: (_input, ctx) => ctx.act('workspace.admit', { workspace: 'default', email: 'intruder@example.com', admin: true }),
};
