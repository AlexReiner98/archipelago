// The Workspace screen's packs: each pack on this server with its state here (active, waiting, off) and why, and
// the owner's switch. The page's own helpers are handed in, so this module imports nothing.

/** The kernel's packs, which are never off. */
const KERNEL = ['core'];

export function packsCard({ h, api, ask, tell, menu, then }) {
  const list = h('ul', { class: 'rows' });
  const turn = async (p, on) => {
    const sure = await ask({
      title: `${on ? 'Turn on' : 'Turn off'} ${p.title}?`,
      message: on ? 'Its tools come back and its items are active again.' : 'Its items stay, dormant: a person can still edit them. Its tools are gone until it is on again.',
      action: on ? 'Turn on' : 'Turn off',
      danger: !on,
    });
    if (sure) api('pack_set', { pack: p.id, on }).then(then, (err) => tell('That was not done', err.message));
  };
  const row = (p) =>
    h(
      'li',
      { class: 'one' },
      h('span', { class: 'grow', title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}` }, h('strong', {}, p.title), ' ', h('span', { class: 'muted small' }, p.version)),
      p.state !== 'active' && h('span', { class: `pill${p.state === 'waiting' ? ' warn' : ' closed'}`, title: p.why ?? '' }, p.state),
      // Turning a pack off is rare, and in its menu; one that is off is turned on in sight.
      KERNEL.includes(p.id) ? h('span', { class: 'menu-room' }) : p.state === 'off' ? h('button', { title: p.why ?? '', onclick: () => turn(p, true) }, 'Turn on') : menu('⋯', [['Turn off', () => turn(p, false), 'danger']]),
    );
  api('packs').then(
    (packs) => list.replaceChildren(...packs.map(row)),
    (err) => list.replaceChildren(h('li', { class: 'muted' }, err.message)),
  );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Each way of working is a pack. Turned off, its items stay, dormant, and its tools leave the list.' }, 'Packs')), list);
}
