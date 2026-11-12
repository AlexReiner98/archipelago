// The findings pack's handler, run in its own sandboxed process by the kernel's pack host. Its one action,
// findings.stand_by, marks a working finding published: the island stands by it, and other islands may read it. It
// reads the finding and answers with the one op; whether the change applies or waits is the rules' to say.

/** The ops that mark a finding published, or why it cannot be: it is no finding, or already is. */
export function standBy(finding) {
  if (!finding || !(finding.type === 'finding' || (finding.is ?? []).includes('finding'))) throw new Error('That is not a finding.');
  if (finding.props?.published === true) return { ops: [], reason: 'Already published', answer: { finding: finding.id, published: true } };
  return {
    ops: [{ op: 'update', id: finding.id, props: { published: true } }],
    reason: `The island stands by "${String(finding.title).slice(0, 60)}": published`,
    answer: { finding: finding.id, published: true },
  };
}

export default {
  'findings.stand_by': async (input, ctx) => standBy(await ctx.read({ get: String(input?.finding ?? '') })),
};
