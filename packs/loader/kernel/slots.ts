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
 * (piece.document); a pack's view of an item, its roadmap or gate say, is a lens preset `on` its type (packs/surface/page/views-kept.js); a figure is the picture it keeps; a diagram is the diagrams pack's part (piece.diagram); rows and a form are the pack's own view and action.
 * A button stands in the page's head, not its column: it opens the pack's action's form, or draws the canvas up as it says.
 * A count stands under the note while it is written: how long it is, against the limit its field's value picks.
 */
export const PIECES = { figure: [], view: ['view'], action: ['action'], picture: ['lens'], fields: ['fields'], page: ['page'], token: [], token_ask: [], held: [], start: [], button: ['label', 'tip'], count: [] } as const;

/** The pages the host still draws itself, which a screen can hold as a piece until a pack draws them from pieces. Others are the family page.<name>. */
export const PAGES: string[] = ['doc', 'public'];

/**
 * The frame the host draws, every page's, and what it hands the part that fills each one beside the item it stands on
 * (its `piece`, as `drawPart` is given it: packs/surface/page/part-host.js). What is in the bar and in the panes spans
 * islands, so it is drawn at the map's version (decision e_5b32vdsg).
 *
 * - `panes`, `tabs`   the panes of the page and the bar of tabs across them (the panes root pack)
 * - `tab.mark`        a mark on one tab: whose it is, how much it holds
 * - `bar`             the bar over the canvas; `bar.views` what its view button opens, `bar.find` find's input and its
 *                     terms, `bar.find.rows` the query's rows above find, shown while find publishes `find_open`,
 *                     `bar.layouts` the layout a view is drawn in. The bar's find slots are handed the canvas's lens
 *                     (Home's when no query is up) with `said`, the answer in brief and the `names` of the items it names
 * - `tabs.land`       a decision, not marks: where a show lands among the tabs and panes (packs/surface/page/part-decide.js)
 * - `tabs.life`       a decision: which kept tabs' sessions have ended or rested
 * - `canvas`, `traces` the canvas itself, and the overlay of traces over it
 * - `sheet`           the sheet over the canvas, an item's one page, handed where the documents beside it are read
 *                     (`reading`), so a part decides which page is shown; `item.menu` what is done rarely to that item
 * - `find`            find at the canvas's foot; `home` the page with no query up; `nav` what the menu leads to
 * - `look`            drawn by nothing: a part that is handed whether the canvas has drawn (`drawn`) and publishes it
 *                     as page state, so a picture is taken at the right moment
 * - `workspace.card`  a card on the workspace page, one pack's say on this workspace
 */
export const FRAME_SLOTS = {
  panes: [],
  tabs: ['tabs', 'current', 'page'],
  'tab.mark': ['tab', 'current'],
  bar: ['current', 'home'],
  'bar.views': ['current', 'home'],
  'bar.find': ['query', 'home', 'answer', 'names'],
  'bar.find.rows': ['query', 'home', 'answer', 'names'],
  'bar.layouts': ['current', 'layout'],
  canvas: ['query', 'layout'],
  traces: ['query'],
  sheet: ['reading'],
  'item.menu': [],
  find: ['query', 'shapes'],
  home: [],
  nav: [],
  look: ['drawn', 'why'],
  'workspace.card': ['workspace', 'section'],
  'tabs.land': ['step', 'tabs', 'drawable'],
  'tabs.life': ['open', 'tabs'],
} as const satisfies Record<string, readonly string[]>;

/**
 * The slots whose part answers a decision rather than marks (`decide(input)` in the part, `askSlot` in the page): the
 * part decides and the root that asked applies it, so the runtime keeps one way in (a mounted part) and two ways out.
 */
export const DECISION_SLOTS: readonly string[] = ['tabs.land', 'tabs.life'];

/** Slots drawn only while a page state another part publishes is set: the rows above find while find is open. */
export const SHOWN_WHILE: Readonly<Record<string, string>> = { 'bar.find.rows': 'find_open' };

/** Every slot of the frame, in the order the page draws them. */
export const FRAME: string[] = Object.keys(FRAME_SLOTS);

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
