// How a session says which item a commit finished: a trailer naming it, which the GitHub pack reads off each push
// and closes the item by. Told to every session in the answers of the map's own tools, so it reaches any agent that
// connects, whatever is or is not written in the folder it works in.

/** What a session is told about committing, once it is working on an item. */
export const commitRule = (id: string): string =>
  `When a commit finishes ${id}, end its message with the line "Closes: ${id}". The push that carries it closes the item, on any branch: the sure way, since the push reader closes only what it can see a commit do.`;
