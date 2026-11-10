// The tests' shop: a workspace made with its admins, a one-time link, and what a buyer agreed to as they paid, handed
// to the pack that keeps it, as a service's billing pack does.
export default {
  async make(input, ctx) {
    const { workspace } = await ctx.act('workspace.create', { name: input.name, email: input.members[0] });
    for (const email of input.members) await ctx.act('workspace.admit', { workspace: workspace.id, email, admin: true });
    return { answer: { workspace: workspace.id } };
  },
  link: async (input, ctx) => ({ answer: await ctx.act('signin.link', input) }),
  agreed: async (input, ctx) => ({ answer: await ctx.act('agreement.record', input) }),
};
