// What deserves attention, as the attention pack's part (task e_hwg5rjzm): for you on Home, read as what to do and
// banded by what it asks of you; on an item's page, only what is that item's, its reasons as marks. It is handed the
// attention view (pack.json: its params from the piece, {piece.person}, {piece.reasons}, and {here}) and its piece's
// title and limit, and answers with marks alone. Pressing or Latest is kept while the page is open: a worker keeps no
// storage, so a reload reads it pressing again.

import { attentionRow, byKind, askOf, moveRow, overflow } from './rows.js';

const ORDERS = [['pressing', 'Pressing', 'What matters most first'], ['latest', 'Latest', 'What changed most recently first']];

/** The items in the order asked: as the view weighs them, or what changed most recently first. */
const ordered = (items, order) => (order === 'latest' ? [...items].sort((a, b) => (a.changed < b.changed ? 1 : a.changed > b.changed ? -1 : 0)) : items);

function marks(input, order) {
  const piece = input?.piece ?? {};
  const answer = input?.views?.attention;
  const title = String(piece.title ?? 'Needs attention').slice(0, 80);
  if (!answer) return ['box', { flow: 'column', gap: 4 }, ['text', { look: 'title' }, title], ['text', { tone: 'bad' }, 'Could not read what needs you']];
  const onItem = Boolean(input?.item);
  const all = ordered(answer.items ?? [], order);
  if (!all.length && onItem) return ['box', {}];
  const limit = Number.isInteger(piece.limit) && piece.limit > 0 ? piece.limit : undefined;
  const latest = order === 'latest';
  const mine = piece.person === 'me';
  const shown = limit ? all.slice(0, limit) : all;
  const split = mine && new Set(all.map((item) => askOf(item).verb)).size > 1;
  const head = ['box', { flow: 'row', gap: 4, align: 'between' },
    ['box', { flow: 'row', gap: 3 }, ['text', { look: 'title' }, title], ...(all.length ? [['text', { look: 'muted' }, String(all.length)]] : [])],
    ...(all.length > 1 ? [['box', { flow: 'row', gap: 2 }, ...ORDERS.map(([key, label, tip]) => ['button', { key: `order:${key}`, look: 'quiet', tip, ...(order === key && { tone: 'accent' }) }, label])]] : []),
  ];
  const body = split
    ? byKind(all, limit, latest)
    : all.length
      ? [['list', { look: 'rows' }, ...shown.map((item) => (mine ? moveRow : attentionRow)(item, latest))], ...(shown.length < all.length ? [overflow(all.slice(shown.length))] : [])]
      : [['text', { look: 'muted' }, 'Nothing needs you.']];
  return ['box', { flow: 'column', gap: 4 }, head, ...body, ...(answer.more ? [['text', { look: 'muted', size: 2, tip: String(answer.more).slice(0, 200) }, 'More than shown']] : [])];
}

export default function attention(input) {
  let now = input, order = 'pressing';
  const draw = () => marks(now, order);
  return {
    marks: draw(),
    update(next) {
      now = next;
      return draw();
    },
    on(event) {
      const to = event?.name === 'press' && /^order:(pressing|latest)$/.exec(event.key ?? '')?.[1];
      if (!to) return undefined;
      order = to;
      return draw();
    },
  };
}
