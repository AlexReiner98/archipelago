// A short note a screen holds (its piece `note`, with its `text`), as the canvas pack's part: words in the map's
// dialect, drawn by the host as the item page draws a note. It reads nothing of the item it stands on.

/** The marks for a piece's text: its note, or nothing when it says nothing. */
export const noteMarks = (piece) => (typeof piece?.text === 'string' && piece.text.trim() ? ['note', {}, piece.text] : ['box']);

export default function note(input) {
  return { marks: noteMarks(input?.piece), update: (next) => noteMarks(next?.piece) };
}
