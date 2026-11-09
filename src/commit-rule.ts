// How a session says which item a commit finished: it records the commit on the map in the same change that closes
// the item, linked settles to it. Nothing reads pushes any more (the GitHub pack went on 9 Nov 2026), so a line in the
// commit message closes nothing. Told to every session in the answers of the map's own tools, so it reaches any agent
// that connects, whatever is or is not written in the folder it works in.

/**
 * What a session is told about committing, once it is working on an item. `open` is what the item is meant to fix
 * that is still open (src/close-offer.ts): the commit settles those it fixes too, and nothing closes them unsaid.
 */
export const commitRule = (id: string, open: string[] = []): string =>
  `When a commit finishes ${id}, record it in the same change that closes ${id}: a commit item with its full sha, linked settles to ${id}.` +
  (open.length ? ` It is meant to fix ${open.join(', ')}, still open: link the commit settles to those it fixes and close them too, and leave out what it does not.` : '');
