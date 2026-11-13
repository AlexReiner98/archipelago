// The menu's pages, as the menu pack's part (task e_pe3fjd75, from ui/nav.js): For you, then the screens the owner has
// given a place in the nav, in their places, then Settings where this session may write; the page open marked. A
// press goes to that page by name (`go` with `page`: you, screen with its id, workspace), so the part names pages,
// never addresses. Its piece says what the host knows: the screens in the nav (`screens`, their names in `names`, in
// their order), which page is open (`at`: you, workspace, or screen:<id>) and whether Settings is offered (`writes`).

const cut = (s, n = 200) => String(s ?? '').slice(0, n);
const words = (v) => (Array.isArray(v) ? v.map(String) : []);

/** The pages offered, each { key, page, of?, title }, in the menu's order. */
export function pagesOf(piece) {
  const ids = words(piece?.screens), names = words(piece?.names);
  return [
    { key: 'you', page: 'you', title: 'For you' },
    ...ids.map((id, i) => ({ key: `screen:${id}`, page: 'screen', of: id, title: names[i] ?? id })),
    ...(piece?.writes === true ? [{ key: 'workspace', page: 'workspace', title: 'Settings' }] : []),
  ];
}

const marks = (piece) =>
  ['box', { flow: 'column', gap: 0 },
    ...pagesOf(piece).map((p) => ['button', { key: p.key, look: 'quiet', tip: cut(p.title), ...(piece?.at === p.key && { tone: 'accent' }) }, cut(p.title, 80)]),
  ];

export default function nav(input, tools) {
  let now = input;
  return {
    marks: marks(now?.piece),
    update(next) {
      now = next;
      return marks(now?.piece);
    },
    on(event) {
      if (event?.name !== 'press') return undefined;
      const p = pagesOf(now?.piece).find((x) => x.key === event.key);
      if (p) tools.go({ page: p.page, ...(p.of && { of: p.of }) });
      return undefined;
    },
  };
}
