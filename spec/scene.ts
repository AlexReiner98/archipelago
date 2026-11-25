/**
 * scene: drawing large graphs. See scene.md.
 *
 * One WebGL2 canvas, owned by the scene plugin, that plugins fill with layers.
 * The scene reads only what is in view, patches what changed, and turns a
 * pointer into an id. Layers draw; they never read the whole graph.
 */
import type { Capability, Cursor, Dispose, Id, Page } from "./common.ts";
import type { Item, Link } from "./graph.ts";

/** A rectangle in world coordinates. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the camera shows: a world rectangle drawn at a scale. */
export interface Viewport extends Rect {
  /** Screen pixels per world unit. Layers use it for level of detail. */
  scale: number;
}

/** An item with its place, as the layout gives it. */
export interface Placed {
  item: Item;
  x: number;
  y: number;
  /** Size, when the layout gives one. */
  w?: number;
  h?: number;
}

/** A link whose two ends are placed. */
export interface PlacedLink {
  link: Link;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * `layout.region`: where things are. Whatever plugin lays the graph out
 * provides it; the scene reads through it so that it only ever loads the
 * view.
 */
export interface LayoutRegion {
  /** Items placed inside the rectangle: bounded like every read. */
  items(region: Rect, page?: { limit?: number; after?: Cursor }): Promise<Page<Placed>>;
  /** Links with at least one end inside the rectangle. */
  links(region: Rect, page?: { limit?: number; after?: Cursor }): Promise<Page<PlacedLink>>;
  /**
   * At a scale where items would be too small to see, groups to draw in
   * their place (a cluster as one mark). Empty when the scale is close
   * enough to draw items.
   */
  groups(region: Rect, scale: number): Promise<Placed[]>;
  /** Calls `on` when places change, with the ids that moved. */
  watch(on: (moved: Id[]) => void): Dispose;
}

/**
 * What changed for the layers since the last frame. The scene works this
 * out from the camera, `layout.region` and `graph.watch`; layers patch
 * their buffers from it and never rebuild them from scratch.
 */
export interface SceneDelta {
  /** Came into view, or new. */
  entered: Placed[];
  enteredLinks: PlacedLink[];
  /** Changed in place: fields or position. */
  changed: Placed[];
  changedLinks: PlacedLink[];
  /** Left the view, or gone. */
  left: Id[];
}

/** What a layer gets each frame. */
export interface Frame {
  gl: WebGL2RenderingContext;
  view: Viewport;
  /** Canvas pixels per CSS pixel. */
  pixelRatio: number;
  /** Milliseconds, for anything animated. */
  time: number;
}

/** What a layer gets in the picking pass. */
export interface PickFrame extends Frame {
  /** The colour to draw an id in, so the scene can read it back. */
  idColor(id: Id): [number, number, number, number];
}

/**
 * A layer: one kind of mark (edges, node glyphs, labels, the live run's
 * highlights, a verdict tint). Its GPU resources are its own: what `init`
 * creates, the disposer it returns frees.
 */
export interface LayerDef {
  /** Unique within the plugin. */
  name: string;
  title?: string;
  init(gl: WebGL2RenderingContext): Dispose | void;
  /** Patches the layer's buffers. */
  update(delta: SceneDelta): void;
  draw(frame: Frame): void;
  /** Draws pickable marks in their id colours. A layer without it can't be clicked. */
  pick?(frame: PickFrame): void;
}

/** `scene.layer`. Layers draw in config-tree order of their plugins: the first at the bottom. */
export interface SceneLayer {
  /** Adds a layer, as the calling plugin's. */
  layer(def: LayerDef): Dispose;
}

/**
 * `scene.view`: the camera. Ephemeral, like `here`: what a person is
 * looking at, not data.
 */
export interface SceneView {
  get(): Viewport;
  /** Moves the camera: to show an item, to follow a run. */
  set(view: Partial<Viewport>): void;
  /** Calls `on` with the view now and every change. */
  watch(on: (view: Viewport) => void): Dispose;
}

export interface Capabilities {
  "layout.region": LayoutRegion;
  "scene.layer": SceneLayer;
  "scene.view": SceneView;
}

export const capabilities: Capability[] = [
  { key: "layout.region", since: 1, doc: "Items, links and groups placed in a rectangle: bounded reads by where things are." },
  { key: "scene.layer", since: 1, doc: "Adds a WebGL2 layer to the one scene surface, patched by deltas." },
  { key: "scene.view", since: 1, doc: "The scene's camera: read it, move it, follow it." },
];
