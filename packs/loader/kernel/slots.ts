// Slots: the places on the page a part fills (decision e_fxayrhma, task e_hnsknspb). A slot name has one owner, as
// every name does (docs/packs.md, "In space"): the host's own (the frame it draws, and each piece and page it still
// draws itself), or the pack one of whose parts opens it (`opens`, packs/loader/kernel/ui-parts.ts). A pack fills a slot of the host,
// of its own, or one it asks for (`slot:<name>` in requires or uses, packs/loader/kernel/packorder.ts); core stands for the host as
// the provider of its slots, as it does for the kernel's events.
//
// Today the pieces and pages a screen holds are the host's (ui/screens.js draws them): each is the slot `piece.<name>`
// or `page.<name>`. The step that moves one into a pack's part takes it off PIECES or PAGES in the same change, and the
// pack's part opens it.

/**
 * The pieces the host draws, each with what it must be told. A document read whole is the publish pack's part
 * (piece.document); a pack's view of an item, its roadmap or gate say, is a lens preset `on` its type (ui/canvases.js); a figure is the picture it keeps; a diagram, the boxes and wires its props.diagram holds; rows and a form are the pack's own view and action.
 * A button stands in the page's head, not its column: it opens the pack's action's form, or draws the canvas up as it says.
 * A count stands under the note while it is written: how long it is, against the limit its field's value picks.
 */
export const PIECES = { figure: [], view: ['view'], action: ['action'], picture: ['lens'], fields: ['fields'], page: ['page'], token: [], token_ask: [], held: [], start: [], diagram: [], button: ['label', 'tip'], count: [] } as const;

/** The pages the host still draws itself, which a screen can hold as a piece until a pack draws them from pieces. Others are the family page.<name>. */
export const PAGES: string[] = [];

/**
 * The frame the host draws, every page's: the bar of saved views, the canvas, the sheet over it, find at its foot, and
 * Home; and in the bar, what its view button opens (`bar.views`), which the host draws and a part fills. What is in the
 * bar spans islands, so it is drawn at the map's version (decision e_5b32vdsg).
 */
export const FRAME = ['bar', 'canvas', 'sheet', 'find', 'home', 'bar.views'];

/** Every slot the host owns: its frame's, and each piece and page it still draws. */
export const HOST_SLOTS: readonly string[] = [...FRAME, ...Object.keys(PIECES).map((p) => `piece.${p}`), ...PAGES.map((p) => `page.${p}`)];

/** A slot's name: a frame slot's word, or dotted words, `<pack>.<name>` for a pack's own, `piece.<name>` or `page.<name>` for a piece or page. */
export const SLOT = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_-]*)*$/;

/** The slots a pack's parts open, read loosely: the manifest's check is ui-parts.ts's. */
export const slotsOpenedBy = (pack: object): string[] => {
  const parts = (pack as { parts?: unknown }).parts;
  return Array.isArray(parts) ? parts.flatMap((p) => (Array.isArray(p?.opens) ? p.opens.filter((s: unknown): s is string => typeof s === 'string') : [])) : [];
};

/** The slots a pack may fill: the host's, those its own parts open, and those it requires or uses (`slot:<name>`). */
export const slotsOpenTo = (pack: { requires?: string[]; uses?: string[] }): string[] => [
  ...HOST_SLOTS,
  ...slotsOpenedBy(pack),
  ...[...(pack.requires ?? []), ...(pack.uses ?? [])].flatMap((n) => (n.startsWith('slot:') ? [n.slice('slot:'.length)] : [])),
];
