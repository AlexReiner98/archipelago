// A pack's parts as an island of the canvas query (verdict e_xqmtjtpw, the owner, 18 Nov 2026: "A: on the query"). The
// term `parts <pack> <island>` gives the answer an island `parts:<island>:<pack>` holding no items, only the pack's parts
// as that island runs them; the layout places it among the others like any island, so it never lies over a neighbour.
// It is laid out with one placeholder item, never drawn, put after the items of the island it is of so the two stand
// together, and its room is its parts' size (how big, the drawing says: ./ghost-parts.js), reserved as its header. Layer: graph. Pure: the answer
// in, the answer with its placeholders and each parts island's room out.

/** An island the term `parts` made: `parts:<island>:<pack>`. */
const PARTS = /^parts:(e_[a-z\d]+):(.+)$/;
export const isParts = (id) => PARTS.test(String(id));

/** The parts islands of an answer, each with the island and pack it is of. */
export const partsIslands = (answer) => (answer.islands ?? []).filter((i) => isParts(i.id)).map((i) => ({ ...i, of: i.parts_of?.island ?? PARTS.exec(i.id)[1], pack_id: i.parts_of?.pack ?? PARTS.exec(i.id)[2] }));

/** The answer with a placeholder item on each parts island, after the last item of the island it is of. */
export function withPartsIslands(answer) {
  const ghosts = partsIslands(answer);
  if (!ghosts.length) return answer;
  const items = [...answer.items];
  for (const g of ghosts) {
    const after = items.map((i) => i.island).lastIndexOf(g.of);
    items.splice(after < 0 ? items.length : after + 1, 0, { id: `${g.id}#`, type: 'task', is: ['work'], title: '', island: g.id, open: true, ghost: true });
  }
  return { ...answer, items };
}

/** Each parts island's room, by its id: as wide and as tall as `sizeOf(pack)` says its parts stand. */
export const partsRoom = (answer, sizeOf) => new Map(partsIslands(answer).map((g) => [g.id, ((s) => ({ w: s.width, h: s.height }))(sizeOf(g.pack))]));

/** The packs of an island whose parts are open as an island of the answer. */
export const openParts = (answer, island) => new Set(partsIslands(answer).filter((g) => g.of === island).map((g) => g.pack_id));
