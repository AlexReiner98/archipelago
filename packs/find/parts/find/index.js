// Find, the find pack's part (task e_rfjwstnu, decision e_2a4mddx8): the field at the canvas's foot that is the query's.
// Typing in it offers the choices of what the words could be, each said by its kind (./choices.js): Words first and lit,
// so nothing is guessed (decision e_45sgrfqd). ↑↓ move the light; Enter takes it and find stays open, emptied, to refine
// further: words in place of the words find set before, every other term and the walk kept, or another term added;
// Shift+Enter adds the words as another set, found as well (e_e3k797d3). Typing a part's word and a space ("only ",
// "not ", "walk ", "limit ", "view ", "style ") puts find in that part: its word stands before the field and the choices
// are that part's; Backspace in an empty field goes back to Find. Escape empties what was typed, then leaves the part,
// then shuts find; so does a press away from it.
//
// A part decides, the runtime draws: it is handed the page's address (the query up, its layout, what it drew), answers
// with marks, moves the page with `go` after a gesture, reads what the words find through the host (`tools.read`), and
// publishes whether it is open (`find_open`, `find_typing`) so the bar's rows rise above it.

import { MODES, choicesFor, ledBy, wordsChoice } from './choices.js';
import { added, schemaOf, walked, withWords, wordsOf } from './lens.js';

const PLACEHOLDER = { Find: 'Find on the map', Only: 'Only what is so: done, a type, within…', Not: 'Leave out: closed, a type', Walk: 'Walk along a link', Limit: 'The most items drawn', View: 'A saved view, by its name', Style: 'A style, by its name' };
const MODE_TIP = 'The part find is in: type another part’s word and a space to go there; Backspace goes back to Find';
const FIELD_TIP = 'Choose what the words are: ↑↓, then Enter; Shift+Enter adds the words as another set';
/**
 * The keys find hears on its field, each held from the field while it means something to find: ↑↓ with choices to
 * move through, Backspace only in an empty field in another part (else it deletes as ever), and Escape while find is open (else
 * it is the page's).
 */
const keysNow = (open, choices, typed, mode) => !open ? [] : [...(choices.length ? ['ArrowUp', 'ArrowDown'] : []), 'Escape', ...(!typed && mode !== 'Find' ? ['Backspace'] : [])];
/** How long typing rests before what it could be is read, in milliseconds. */
const REST = 160;

const num = (input, name, or) => (Number.isFinite(input?.style?.numbers?.[name]) ? input.style.numbers[name] : or);
const cut = (s, most = 200) => String(s ?? '').slice(0, most);

export default function find(first, tools) {
  let input = first;
  let open = false, mode = 'Find', typed = '', choices = [], shownFor = '', lit = 0, asked = 0, wait, focus = false;

  // The lens up: the canvas's query as the slot is handed it (Home's when none), without the words the host says it in.
  const lensUp = () => {
    const { said: _said, ...lens } = input?.query ?? input?.address?.query ?? input?.address?.home ?? { filter: {} };
    return { ...lens, filter: lens.filter ?? {} };
  };
  const read = (name, params) => (tools.read ? tools.read(name, params).catch(() => null) : Promise.resolve(null));
  const publish = () => (tools.state?.('find_open', open ? '1' : null), tools.state?.('find_typing', open && (typed.trim() || mode !== 'Find') ? '1' : null));

  /** One choice as a row: its kind, its name to press, what it is, and what it would change. */
  const row = (c, i) => ['box', { key: `c${i}`, flow: 'row', gap: 4, pad: 2, tip: cut(c.title), ...(i === lit && { tone: 'accent', look: 'band' }), ...(c.leaves && { lights: c.leaves.slice(0, 200) }) },
    ['text', { look: 'mark' }, cut(c.kind, 40)],
    ['button', { key: `c${i}.take`, look: 'quiet', tip: cut(c.title), ...(c.view && { view: c.view }) }, cut(c.label)],
    ...(c.note ? [['text', { look: 'muted', size: 2 }, cut(c.note, 80)]] : []),
    ...(c.count ? [['text', { look: 'muted', size: 2 }, cut(c.count, 20)]] : []),
  ];

  const marks = () => {
    const field = ['input', { key: 'q', kind: 'search', value: typed, hint: PLACEHOLDER[mode], label: 'Find on the map', tip: FIELD_TIP, grow: true, keys: keysNow(open, choices, typed, mode), ...(focus && { focus: true }) }];
    focus = false;
    return ['box', { flow: 'column', gap: 2 },
      ...(open && choices.length ? [['list', { look: 'rows' }, ...choices.map(row)]] : []),
      ['box', { flow: 'row', gap: 4, align: 'center' }, ...(open ? [['text', { look: 'mark', tip: MODE_TIP }, mode]] : []), field],
    ];
  };
  const draw = () => (publish(), tools.marks?.(marks()));

  /** Open find to type in. */
  const toOpen = () => {
    if (!open) (open = true), (focus = true);
  };
  /** Empty find to type the next term: back in Find, open, its choices gone. */
  const again = () => ((typed = ''), (mode = 'Find'), (choices = []), (shownFor = ''), (lit = 0), clearTimeout(wait), asked++);
  /** Shut find: what was typed goes. */
  const shut = () => (again(), (open = false));
  /** Put find in a part of the lens, and read its choices. */
  const toMode = (m) => ((mode = m), (choices = []), (lit = 0), (focus = true), look());

  /** Move the page where a choice says: only ever after the gesture that took it. */
  function take(c, add = false, pressed = false) {
    if (!c) return;
    if (c.mode) return void ((typed = ''), toMode(c.mode));
    const lens = lensUp();
    again();
    focus = true;
    // A view pressed is opened by the host, as every mark that names a view is; taken with Enter, find moves the page.
    if (c.view) return void (pressed || tools.go?.({ view: c.view }));
    if (c.item) return void tools.go?.({ item: c.item });
    if (c.shape) return void tools.go?.({ query: lens, layout: { shape: c.shape } });
    if (c.walk) return void tools.go?.({ query: walked(lens, c.walk) });
    if (c.limit) return void tools.go?.({ query: { ...lens, limit: c.limit } });
    if (c.words) return void tools.go?.({ query: { ...lens, filter: withWords(lens.filter ?? {}, add ? [...wordsOf(lens.filter), c.words] : [c.words]) } });
    if (c.term) tools.go?.({ query: added({ ...lens, filter: lens.filter ?? {} }, c.term) });
  }

  /** What the words could be: the words at once, the rest once the reads answer; how many the words find, which Enter brings. */
  async function look() {
    const q = typed.trim();
    const mine = ++asked;
    const finding = mode === 'Find';
    if (finding && !q) return void ((choices = []), draw());
    // In Find the words are drawn at once, unless a kind's word leads them: then that kind's choices come first.
    const seeded = finding && !ledBy(mode, q);
    choices = seeded ? [wordsChoice(q)] : [];
    shownFor = seeded ? q : '';
    lit = 0;
    draw();
    const lens = lensUp();
    const { only, not } = lens.filter ?? {};
    const most = num(input, 'find_choice_items', 3);
    const c = { most, wide: num(input, 'term_find_most', 12), lens, schema: schemaOf(input?.words), read, views: viewsOf(input), shapes: input?.shapes };
    const [all, counted] = await Promise.all([
      choicesFor(mode, q, c).catch(() => []),
      finding && q ? read('flat', { filter: { find: [`text ${q}`], ...(only && { only }), ...(not && { not }) }, limit: most }) : null,
    ]);
    if (mine !== asked) return;
    const words = all.find((x) => x.words === q);
    if (words && counted) words.note = `${counted.matched ?? counted.items?.length ?? 0} found`;
    shownFor = q;
    choices = all;
    draw();
    countChoices(all, lens, mine);
  }

  /**
   * What each choice would change, once drawn: +12 found that is not drawn yet, or −34 of what is drawn left out, asked
   * in one read of the choices in sight. A choice that leaves out nothing or everything is none, and goes.
   */
  async function countChoices(all, lens, mine) {
    const drawn = input?.address?.drawn;
    const ids = Array.isArray(drawn?.ids) ? drawn.ids : null;
    if (!ids || lens.view) return;
    const here = new Set(ids);
    const part = mode.toLowerCase();
    const offered = all.filter((c) => c.term?.[part]).slice(0, num(input, part === 'find' ? 'find_count_most' : 'find_check_most', 12));
    if (!offered.length) return;
    const told = await read('flat', { filter: lens.filter ?? {}, preview: { part, terms: offered.map((c) => c.term[part]), ids } });
    if (!told?.preview || mine !== asked) return;
    for (const c of offered) {
      const got = Array.isArray(told.preview[c.term[part]]) ? told.preview[c.term[part]] : [];
      if (part === 'find') {
        const shown = num(input, 'find_count_shown', 200);
        c.count = got.length > shown ? `+${shown}+` : `+${got.filter((id) => !here.has(id)).length}`;
      } else {
        c.count = `−${got.length}`;
        // Pointing at it lights what it keeps, the rest faded.
        const gone = new Set(got);
        c.leaves = ids.filter((id) => !gone.has(id));
        c.idle = !drawn.cut && ids.length > 0 && (got.length === 0 || got.length === ids.length);
      }
    }
    const held = choices[lit];
    choices = choices.filter((c) => !c.idle);
    lit = Math.max(0, choices.indexOf(held));
    draw();
  }

  /** Typing: a part's word and a space puts find in that part; else the choices are read once typing rests. */
  function edited(value) {
    toOpen();
    const [, word, rest] = /^(\S+)\s(.*)$/.exec(value) ?? [];
    const into = word && MODES.find((m) => m.toLowerCase() === word.toLowerCase());
    if (into) return ((typed = rest), toMode(into), marks());
    typed = value;
    clearTimeout(wait);
    wait = setTimeout(look, REST);
    publish();
    return marks();
  }

  /** Enter takes the lit choice drawn for what is typed now; typed faster than they came, in Find, the words. */
  function submitted(value, add) {
    clearTimeout(wait);
    typed = value ?? typed;
    const q = typed.trim();
    const ready = shownFor === q && choices[lit];
    if (ready) take(choices[lit], add);
    else if (q && mode === 'Find' && !ledBy(mode, q)) take(wordsChoice(q), add);
    return marks();
  }

  function key(name, empty) {
    if ((name === 'ArrowDown' || name === 'ArrowUp') && choices.length) lit = (lit + (name === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
    else if (name === 'Backspace' && empty && mode !== 'Find') toMode('Find');
    else if (name === 'Escape') {
      if (typed) (typed = ''), (focus = true), look();
      else if (mode !== 'Find') toMode('Find');
      else shut();
    } else return undefined;
    publish();
    return marks();
  }

  publish();
  return {
    marks: marks(),
    update(next) {
      input = next;
      return marks();
    },
    on(ev) {
      const k = String(ev?.key ?? '');
      if (ev?.name === 'away' || ev?.name === 'leave') return open ? (shut(), publish(), marks()) : undefined;
      if (ev?.name === 'summon' || (k === 'q' && ev?.name === 'focus')) return (toOpen(), publish(), marks());
      if (k === 'q' && ev.name === 'edit') return edited(cut(ev.value, 500));
      if (k === 'q' && ev.name === 'submit') return submitted(cut(ev.value, 500), Boolean(ev.shift));
      if (k === 'q' && ev.name === 'key') return key(String(ev.value), Boolean(ev.empty));
      const pressed = /^c(\d+)\.take$/.exec(k);
      if (pressed && ev.name === 'press') return (take(choices[Number(pressed[1])], Boolean(ev.shift), true), publish(), marks());
      return undefined;
    },
    end() {
      clearTimeout(wait);
      tools.state?.('find_open', null);
      tools.state?.('find_typing', null);
    },
  };
}

/** The views the person may pick, from the saved_views read: not those a document brings in. */
function viewsOf(input) {
  const pictures = input?.views?.saved_views?.pictures;
  return Array.isArray(pictures) ? pictures.filter((c) => typeof c?.lens === 'string' && typeof c?.title === 'string' && !c.document) : [];
}
