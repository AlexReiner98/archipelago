// A chat's row in the side bar is drawn from pieces (task e_g5r2rzg6; Alex, 18 Nov 2026: every signal ships with its
// UI, and the UI stays composable). A piece is a module of its own, `session-piece-<name>.js` in a root pack's page/,
// whose default export reads an open session (as the sessions view answers it) and answers what it adds to the row as
// data, or nothing:
//   mark    a glyph in the row's mark column (an empty one keeps the room)
//   word    a word or a few, cut first as the row narrows
//   tip     a line of the row's tooltip
//   hue     a colour the piece is painted in (--session-hue)
//   cls     the classes it is drawn with, beside isl-piece and its name
//   lights  ids of items lit on the canvas while the row is pointed at
//   opens   true for the one piece a press opens the chat's page from (its word is the row's name)
// Which pieces a row has, and in what order, is the style's (rows.sessions): a new signal is a new module and its name
// there, and no edit to the row (./island-sessions.js).

import { state } from './base.js';

const NAME = /^[a-z][a-z0-9_]*$/;
/** Each piece's module once asked for: its read, or null where none loads. */
const loaded = new Map();
const load = (name) => {
  if (!loaded.has(name))
    loaded.set(
      name,
      import(`./session-piece-${name.replaceAll('_', '-')}.js`).then(
        (m) => (typeof m.default === 'function' ? m.default : null),
        () => null,
      ),
    );
  return loaded.get(name);
};

/** The pieces the style names for a chat's row, in its order. */
export const pieceNames = () => (Array.isArray(state.style?.rows?.sessions) ? state.style.rows.sessions.filter((n) => typeof n === 'string' && NAME.test(n)) : []);

/** The pieces' reads, in the style's order, once every one has loaded: [name, read] for each that did. */
export const pieces = () => Promise.all(pieceNames().map(async (name) => [name, await load(name)])).then((all) => all.filter(([, read]) => read));

/** What each piece adds to a session's row, in order: { name, ...what it answered }. A piece that throws adds nothing. */
export function piecesOf(s, reads) {
  const out = [];
  for (const [name, read] of reads) {
    let got;
    try {
      got = read(s);
    } catch {
      got = null;
    }
    if (got && typeof got === 'object') out.push({ ...got, name });
  }
  return out;
}
