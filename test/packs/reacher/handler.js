// The reacher pack's handler: one action inside its reach, one outside it.
export default {
  async 'reacher.keep'(input) {
    return { ops: [{ op: 'create', ref: 'n', type: 'reacher.note', title: input.title }], reason: `Keep "${input.title}"`, answer: { note: '{n}' } };
  },
  async 'reacher.rename'(input) {
    return { ops: [{ op: 'update', id: input.id, title: input.title }], reason: `Rename to "${input.title}"` };
  },
};
