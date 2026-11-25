/**
 * Names as pictures, for while the tree zooms. A name is turned along its
 * ray, and a turned text drawn at a new size has every letter drawn anew
 * (the browser keeps upright letters, not turned ones): a zoom drew every
 * name from nothing each frame. So while the zoom changes, each name is
 * drawn upright once into one shared picture (an atlas), at one of a few
 * sizes per doubling (`name_steps`), and that picture is turned and placed
 * where the name goes. At rest the names are text again, as before.
 *
 * The atlas fills shelf by shelf; when it is full it is wiped and filled
 * again with what the frame needs. A name too big for it is drawn as text.
 */

/** A spot in the atlas, in its pixels. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the next picture goes: shelves of the tallest picture on each, left to right, then down. */
export class Shelves {
  private x = 0;
  private y = 0;
  private tall = 0;
  readonly size: number;
  constructor(size: number) {
    this.size = size;
  }
  /** A spot w by h, or none when the atlas is full. */
  take(w: number, h: number): Spot | undefined {
    if (w > this.size || h > this.size) return undefined;
    if (this.x + w > this.size) (this.x = 0), (this.y += this.tall), (this.tall = 0);
    if (this.y + h > this.size) return undefined;
    const spot = { x: this.x, y: this.y, w, h };
    this.x += w + 1;
    this.tall = Math.max(this.tall, h + 1);
    return spot;
  }
  reset(): void {
    this.x = this.y = this.tall = 0;
  }
}

export class Atlas {
  readonly canvas: OffscreenCanvas;
  private c: OffscreenCanvasRenderingContext2D;
  private shelves: Shelves;
  private at = new Map<string, Spot>();
  constructor(size = 2048) {
    this.canvas = new OffscreenCanvas(size, size);
    this.c = this.canvas.getContext("2d")!;
    this.shelves = new Shelves(size);
  }
  /** The picture for `key`, drawn by `draw` at its spot's top left the first time it is asked for. */
  get(key: string, w: number, h: number, draw: (c: OffscreenCanvasRenderingContext2D, x: number, y: number) => void): Spot | undefined {
    const had = this.at.get(key);
    if (had) return had;
    let spot = this.shelves.take(w, h);
    if (!spot) {
      this.clear();
      spot = this.shelves.take(w, h);
      if (!spot) return undefined;
    }
    this.c.save();
    draw(this.c, spot.x, spot.y);
    this.c.restore();
    this.at.set(key, spot);
    return spot;
  }
  clear(): void {
    this.at.clear();
    this.shelves.reset();
    this.c.setTransform(1, 0, 0, 1, 0, 0);
    this.c.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
