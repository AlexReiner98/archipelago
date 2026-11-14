// The page in look mode (`?look`), as look_draw's part: the server's own browser opens the app for an agent's look
// (packs/look_draw/kernel/look-draw.ts) and takes the picture once the page says it has drawn. The runtime
// (ui/look.js) marks the page `drawing` as it loads and mounts this part once the canvas has said its first word on
// it, two frames on, so what was mounted has been painted, handing it that word as its piece's settings (`drawn`, the
// state, and `why`). The part decides what the look reads: the first word only, as drawn, empty or error, and why, cut short. It publishes that as page state
// (`look`, `look_why`), which the runtime writes on the root; it draws nothing.

export const STATES = ['drawn', 'empty', 'error'];
/** The longest why a look keeps. */
export const WHY_MOST = 300;

/** What a look reads of a word the canvas said: its state, one of three (anything else is drawn), and why. */
export function lookOf(drawn) {
  if (!drawn || typeof drawn !== 'object') return null;
  const state = STATES.includes(drawn.state) ? drawn.state : 'drawn';
  const why = drawn.why === undefined || drawn.why === null || drawn.why === '' ? null : String(drawn.why).slice(0, WHY_MOST);
  return { state, why };
}

export default function page(input, tools) {
  let said = false;
  // The canvas's first word is the one taken: why first, so the look that sees the state sees why with it.
  const hear = (next) => {
    const piece = next?.piece;
    const look = said || !piece?.drawn ? null : lookOf({ state: piece.drawn, why: piece.why });
    if (!look) return undefined;
    said = true;
    if (look.why) tools.state('look_why', look.why);
    tools.state('look', look.state);
    return undefined;
  };
  hear(input);
  return { marks: undefined, update: hear };
}
