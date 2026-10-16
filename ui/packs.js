// The Workspace screen's packs: each pack on this server with its state here (active, waiting, off) and why, and
// the owner's switch. The page's own helpers are handed in, so this module imports nothing.

/** The kernel's packs, which are never off. */
const KERNEL = ['core', 'sys'];

export function packsCard({ h, api, ask, tell, then }) {
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
      {},
      h(
        'div',
        { class: 'row-top', style: 'flex-wrap: nowrap; align-items: center' },
        h('span', { class: 'grow', title: `${p.title} ${p.version}${p.why ? `: ${p.why}` : ''}`, style: 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap' }, h('strong', {}, p.title), ' ', h('span', { class: 'muted small' }, p.version)),
        h('span', { class: `pill${p.state === 'active' ? ' ok' : p.state === 'waiting' ? ' warn' : ' closed'}`, title: p.why ?? '' }, p.state),
        !KERNEL.includes(p.id) && h('button', { title: p.why ?? '', style: 'white-space: nowrap', onclick: () => turn(p, p.state === 'off') }, p.state === 'off' ? 'Turn on' : 'Turn off'),
      ),
    );
  api('packs').then(
    (packs) => list.replaceChildren(...packs.map(row)),
    (err) => list.replaceChildren(h('li', { class: 'muted' }, err.message)),
  );
  return h('section', { class: 'card wide' }, h('header', {}, h('h2', { class: 'hinted', title: 'Each way of working is a pack. Turned off, its items stay, dormant, and its tools leave the list.' }, 'Packs')), list);
}
