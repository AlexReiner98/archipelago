// How a session says which item a commit finished: a trailer naming it, which the GitHub pack reads off each push
// and closes the item by. Told to every session in the answers of the map's own tools, so it reaches any agent that
// connects, whatever is or is not written in the folder it works in.

/**
 * What a session is told about committing, once it is working on an item. `open` is what the item is meant to fix
 * that is still open (src/close-offer.ts): the same line closes those the commit fixes, and nothing closes them unsaid.
 */
export const commitRule = (id: string, open: string[] = []): string =>
  `When a commit finishes ${id}, end its message with the line "Closes: ${id}". The push that carries it closes the item, on any branch: the sure way, since the push reader closes only what it can see a commit do.` +
  (open.length ? ` It is meant to fix ${open.join(', ')}, still open: add to that line those the commit fixes ("Closes: ${id} ${open[0]}"), and leave out what it does not.` : '');
