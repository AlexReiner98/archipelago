// The chime pack's handler: told an item came due, it tells the owner, for its own chimes alone.
export default {
  async 'item.due'(input) {
    const e = input.event;
    if (e.detail?.type !== 'chime') return {};
    return { notify: [{ title: `Rang: ${e.reason}`, about: e.target }] };
  },
};
