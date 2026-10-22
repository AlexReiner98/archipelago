// The tests' agreements: a terms and a privacy policy at fixed versions, a workspace made with its admin and a
// one-time link, and agreement recorded for a member as a signup would.
export default {
  documents: () => ({
    answer: [
      { id: 'terms', title: 'Terms of Service', url: '/x/terms/terms', version: '2026-10-21', also: [{ title: "Conditions d'utilisation", url: '/x/terms/terms_fr' }, { title: 'Bad', url: 'javascript:alert(1)' }] },
      { id: 'privacy', title: 'Privacy Policy', url: 'https://example.com/privacy', version: 'v1' },
      { id: 'Bad id', title: 'Left out', url: '/x', version: '1' },
    ],
  }),
  async make(input, ctx) {
    const { workspace } = await ctx.act('workspace.create', { name: input.name });
    for (const email of input.members) await ctx.act('workspace.admit', { workspace: workspace.id, email, admin: true });
    return { answer: { workspace: workspace.id } };
  },
  link: async (input, ctx) => ({ answer: await ctx.act('signin.link', input) }),
  agreed: async (input, ctx) => ({ answer: await ctx.act('agreement.record', input) }),
};
