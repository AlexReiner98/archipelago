// What a drawing's code is handed, as types: for tsc with checkJs over code kept on the map (scripts/map-code.ts
// copies this file into each pulled folder beside a jsconfig.json). Not served and not run: the truth is the code
// that hands these over, and this file follows it.
//
// Two kinds of drawing code:
//   - A layout's own code (core's layout type, field `code`): `export default function draw(input)`, run by
//     packs/walls/page/draw.js. In a pulled index.js: /** @param {import('./draw.d.ts').DrawInput} input */
//   - A drawing a pack ships, or the owner's version of one (field `modules`): `export function picture(input, tools)`,
//     answering with marks, run by packs/walls/page/draw-inside.js (docs/layouts.md, "What a drawing is").
//     /** @param {import('./draw.d.ts').PictureInput} input @param {import('./draw.d.ts').PictureTools} tools */

// ---------------------------------------------------------------- shared

/** An item's id: `e_` and eight letters or digits. */
export type ItemId = string;

/** An item as a query's answer holds it. What a lens answer adds (inside, place, state...) is there when the view asks for it. */
export interface AnswerItem {
  id: ItemId;
  title: string;
  type: string;
  /** The starter type it extends. */
  root?: string;
  status?: string;
  /** Its values by field name: a change writes them back as props. */
  fields?: Record<string, unknown>;
  /** The item it is part of, in a lens answer. */
  inside?: ItemId | null;
  /** Its order among what it is inside. */
  place?: number;
  state?: { needs_you?: boolean; blocked?: boolean; sessions: number; [k: string]: unknown };
  /** What is inside it, counted at every depth. */
  within?: { items: number; needs_you?: number; blocked: number; work: number; sessions: number; [k: string]: unknown };
  size?: { work: number; [k: string]: unknown };
  [k: string]: unknown;
}

/** A link as a query's answer holds it. */
export interface AnswerLink {
  id?: string;
  /** The link type (depends_on, part_of, ...). */
  kind: string;
  from: ItemId;
  to: ItemId;
  props?: Record<string, unknown>;
  [k: string]: unknown;
}

/** What the query answered. */
export interface Answer {
  items: AnswerItem[];
  links?: AnswerLink[];
  /** The person looking, in a lens answer. */
  viewer?: unknown;
  /** How the picture came to be, where the view keeps steps (docs/layouts.md, "A picture that plays"). */
  steps?: unknown[];
  [k: string]: unknown;
}

/** An op, as `change` takes it (query `actions` with action `change` says each field). A drawing may make one item and link items. */
export type Op =
  | { op: 'create'; ref?: string; type: string; title: string; body?: string; status?: string; props?: Record<string, unknown>; [k: string]: unknown }
  | { op: 'update'; id: ItemId; title?: string; body?: string; status?: string; props?: Record<string, unknown>; [k: string]: unknown }
  | { op: 'link'; type?: string; from: string; to: string; props?: Record<string, unknown>; [k: string]: unknown }
  | { op: 'unlink'; relation: string }
  | { op: 'archive'; id: ItemId };

/** What came of a change asked for: sent, held for a person (`proposal`, and the rule's words in `held`), or why not. */
export interface ChangeResult {
  status?: string;
  /** Each create's ref, to the id it was given. */
  created?: Record<string, ItemId>;
  proposal?: string;
  held?: string;
  error?: string;
}

// ---------------------------------------------------------------- a layout's code: draw(input)

/** The page's colours by what each is for. `sea` is the ground; take `accent` for what must stand out on it. */
export interface Theme {
  sea: string;
  land: string;
  inner: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  blocked: string;
  you: string;
  session: string;
  done: string;
  warn: string;
  /** Whether the page is dark. */
  dark: boolean;
  [k: string]: unknown;
}

/** The frame's size, in CSS pixels, and its device pixel ratio (at most 2). */
export interface Size {
  width: number;
  height: number;
  dpr: number;
}

/** Where the pointer is and what it does, over the canvas. */
export interface PointerInfo {
  x: number;
  y: number;
  button: number;
  buttons: number;
  /** The wheel's turn; 0 for every other event. */
  deltaY: number;
  shift: boolean;
  /** Ctrl, or Cmd on a Mac. */
  ctrl: boolean;
}

/** What a text field the page drew holds: its value, never a key typed. `done` when Enter or leaving it. */
export interface FieldEvent {
  key: string;
  value: string;
  done: boolean;
}

/** Every event a layout's code can hear, by name, with what it is told. */
export interface DrawEvents {
  pointerdown: PointerInfo;
  pointermove: PointerInfo;
  pointerup: PointerInfo;
  pointerleave: PointerInfo;
  wheel: PointerInfo;
  /** The frame changed size: `size` is already current. */
  resize: Size;
  field: FieldEvent;
  /** The query answered again as the map changed. Code that does not listen is started again in a new frame. */
  answer: Answer;
}

export type DrawEventName = keyof DrawEvents;

/** Where a text field goes over the canvas, and what it shows. */
export interface FieldAt {
  x: number;
  y: number;
  width: number;
  height: number;
  value?: string;
  placeholder?: string;
  title?: string;
}

/** A thing of the answer as a tree, with its counts and those of all inside it. */
export interface TreeNode extends AnswerItem {
  kids: TreeNode[];
  up: TreeNode;
  depth: number;
  /** It and everything inside it. */
  all: number;
  /** Work in it and inside it. */
  work: number;
  /** What is blocked. */
  blk: number;
  /** What needs the person looking. */
  you: number;
  /** Sessions at work on it. */
  at: number;
}

/** The tree's root: everything, at depth -1. */
export interface TreeRoot {
  kids: TreeNode[];
  depth: -1;
  title: string;
}

export interface Tree {
  /** The person looking, as the answer names them. */
  me: unknown;
  byId: Map<ItemId, TreeNode>;
  root: TreeRoot;
}

/** The cursors a layout's code may set; any other is ignored. */
export type CursorName = 'default' | 'pointer' | 'grab' | 'grabbing' | 'crosshair' | 'move';

/** What `draw()` is handed: everything a layout's code has. */
export interface DrawInput {
  /** Walled in, an OffscreenCanvas in a worker (2D or WebGL); opened (drawings_open), the frame's own canvas. */
  canvas: OffscreenCanvas | HTMLCanvasElement;
  /** Opened, an element of the app's page over the picture, for a panel of the code's own; walled in, null. */
  root: HTMLElement | null;
  /** Whether it runs walled in (a worker in a sandboxed frame), not opened. */
  sandboxed: boolean;
  answer: Answer;
  /** The style's fields it is drawn with: its settings, under the style's and the view's own. */
  style: Record<string, unknown>;
  theme: Theme;
  /** Kept current as the frame resizes. */
  size: Size;
  tree(): Tree;
  /** three.js, as its authors build it (0.160). */
  three(): Promise<any>;
  on<K extends DrawEventName>(name: K, fn: (event: DrawEvents[K]) => void): void;
  /** Opens an item's page; opened, an https address too. */
  open(id: ItemId | string): void;
  /** Shows words by the pointer; null hides them. */
  tip(text: string | null, x: number, y: number): void;
  cursor(name: CursorName): void;
  /** Puts a text field the page draws over the canvas; null takes it away. on('field') hears what it holds. */
  field(key: string, at: FieldAt | null): void;
  /** Asks the page to send ops as the person looking: applied where it writes only the layout's `writes`, held for them otherwise. */
  change(ops: Op[], reason?: string): Promise<ChangeResult>;
}

/** A layout's code: index.js's default export. */
export type Draw = (input: DrawInput) => void | Promise<void>;

// ---------------------------------------------------------------- a drawing a pack ships: picture(input, tools)

/** A mark: `[tag, attributes, ...what is in it]`; a string is text. Only the tags and attributes packs/walls/page/marks.js lists are made. */
export type Mark = string | [string, MarkAttributes?, ...Mark[]];

export interface MarkAttributes {
  /** Names the mark for patches and events. */
  key?: string;
  /** The events the drawing is told of for this mark; `add` is a button the page answers itself. */
  on?: MarkEventName[];
  /** The item it stands for. */
  item?: ItemId;
  [attribute: string]: unknown;
}

export type MarkEventName = 'enter' | 'leave' | 'click' | 'seen' | 'add';

/** What a drawing is told: an event on a keyed mark, or what the page lit on a surface. */
export type PictureEvent =
  | { name: 'enter' | 'leave' | 'click' | 'seen'; key: string; from?: string }
  | { name: 'light'; ids: ItemId[] | null };

/** A key row: what one mark the picture uses means. */
export interface KeyRow {
  glyph: Mark;
  label: string;
  item?: ItemId;
}

/** What a picture opens on: its marks and how they look, or a message when there is nothing to draw. */
export interface Scene {
  svg?: Mark;
  key?: KeyRow[];
  bar?: Mark;
  /** Read only inside its own picture. */
  css?: string;
  size?: { width: number; height: number };
  start?: unknown;
  /** Laid out by the page, to its width: not panned or zoomed. */
  flat?: boolean;
  /** Drawn again when its pane settles into another shape. */
  shaped?: boolean;
  /** The mark a flat picture is brought to. */
  focus?: string;
  /** Asks for a surface to paint on (tools.surface()). */
  surface?: { key: string; [k: string]: unknown };
  message?: string;
  [k: string]: unknown;
}

/** A change to what is drawn. A tip patch shows a mark beside the keyed mark, or with null takes it away. */
export type Patch = { tip: { key: string; mark: Mark } | null } | Record<string, unknown>;

/** What is in view as the plane moves, in the picture's units. */
export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

/** What `picture()` is handed. */
export interface PictureInput {
  answer: Answer;
  /** The style's fields. */
  style: Record<string, unknown>;
  /** The titles of the types the answer holds, by type. */
  types: Record<string, string>;
  /** The values each type's fields may take, by type then field. */
  fields: Record<string, Record<string, unknown[]>>;
  /** Each link type's title, by link type. */
  relations: Record<string, string>;
  /** How wide the picture's host is. */
  width: number;
  /** How tall, or 0 where the host is as tall as what it holds. */
  height: number;
  /** Whether the reader asked for less motion. */
  reduced: boolean;
  /** What the session may do: read, write, admin. */
  may: string[];
}

/** A text role of the style: how `measure` sets a text. */
export interface TextRole {
  weight?: number;
  style?: string;
  case?: string;
  track?: string;
}

/** A canvas of the drawing's own, shown over its picture: what tools.surface() resolves to. */
export interface Surface {
  canvas: OffscreenCanvas;
  size: { width: number; height: number };
  /** The page's colours (`page`, by the theme's names) and the lens's. */
  colours: { page?: Record<string, string>; lens?: Record<string, string>; [k: string]: unknown };
  three(): Promise<any>;
  resized(fn: (size: { width: number; height: number }) => void): void;
  /** Sends what is painted to the page. */
  show(): void;
}

/** What `picture()` is handed beside its input. */
export interface PictureTools {
  /** Asks the page to put a change to the person and send it as theirs: one item made and items linked, nothing else. */
  change(ops: Op[], reason?: string): Promise<ChangeResult>;
  /** Calls an action or view the drawing's view sends, as the person. */
  act(name: string, params?: Record<string, unknown>, said?: { asks?: unknown[] }): Promise<{ answer?: unknown; created?: Record<string, ItemId>; changed?: boolean; error?: string }>;
  /** The gesture a drawing opts into: `on(key)` gives `['add']` for an island's mark where the session may write. */
  gestures(spec?: { island?: (key: string) => unknown }): { on(key: string): MarkEventName[]; hear(): boolean };
  /** A text's width, as the page's canvas would give it. */
  measure(text: string, px: number, font?: string, role?: TextRole): number;
  patch(list: Patch[]): void;
  open(id: ItemId): void;
  /** Resolves at the page's next frame, with its time. */
  frame(): Promise<number>;
  /** The surface the scene asked for, or null. */
  surface(): Promise<Surface | null>;
}

type Maybe<T> = T | Promise<T>;

/** What `picture()` answers with. */
export interface Picture {
  scene: Scene;
  on?(event: PictureEvent): Maybe<Patch[] | void>;
  viewport?(view: Viewport): Maybe<Patch[] | void>;
  restyle?(style: Record<string, unknown>): Maybe<Patch[] | void>;
  end?(): void;
}

/** A drawing's index.js `picture` export. */
export type PictureFn = (input: PictureInput, tools: PictureTools) => Maybe<Picture>;
