// What a look's page breaks of the house rules a machine can read (docs/canvas.md, CLAUDE.md's UI rules), read off
// the page in Chrome while it is drawn (look-draw.ts): the probe below gathers what each element is as drawn, and the
// rules are small pure functions over that, so each is tried without Chrome (test/look-checks.test.ts). A rule says a
// short line naming the mark; the answer holds at most MOST of each, so a page that breaks one everywhere is told once
// and how often, not a thousand times.
//
// past_frame: a mark extends past its frame: the viewport's width for the page's own parts, its island's land for a
// mark drawn on an island (`.lf-region`, packs/canvas/layouts/flow/islands.js). The canvas pans, so a mark beyond
// the viewport on it is not past anything; nor is one inside a box that clips or scrolls it (that box is checked).
// small_text: text drawn under LEAST px, scale included (a zoomed drawing's text as it reaches the eye).
// wrapped_row: an element meant as one line (a row by its class, `data-one-line`, or one that cuts with an
// ellipsis) whose text runs on more than one line.
// on_island: a mark of one island (in its `.lf-region`) drawn over another island's land, as a pack's parts set
// beside an island can: past_frame sees only a mark's own island, so this reads every island's land.

/** A box on the page, in CSS px of the viewport. */
export interface Box {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** One element as the probe saw it drawn. */
export interface Seen {
  /** How the mark is named: its item, else its tag and classes. */
  mark: string;
  /** Its first words, to say which one it is. */
  text?: string;
  box: Box;
  /** The frame it must keep within, and what that frame is. */
  frame?: Box;
  frame_is?: 'viewport' | 'land';
  /** Its text's size as drawn, in px, where it has text of its own. */
  px?: number;
  /** The island it is drawn on, by its name, where it is in one's region. */
  island?: string;
  /** Meant as one line, and how many lines its text took. */
  one_line?: boolean;
  lines?: number;
}

/** What the probe answers: the viewport and every element it read. */
export interface Probe {
  width: number;
  height: number;
  seen: Seen[];
  /** Each island's land, by its name: its rects as drawn. */
  lands?: Land[];
}

export interface Land {
  island: string;
  rects: Box[];
}

export interface Check {
  rule: 'past_frame' | 'small_text' | 'wrapped_row' | 'on_island';
  mark?: string;
  said: string;
}

/** The least size text is drawn at. */
export const LEAST_PX = 10;
/** How far past its frame a mark may go and not be told: a pixel's rounding. */
const SLACK = 1;
/** The most checks of one rule a look answers with. */
export const MOST = 12;

const name = (s: Seen) => (s.text ? `${s.mark} “${s.text}”` : s.mark);
const round = (n: number) => Math.round(n * 10) / 10;

/** How far a box goes past its frame on each side, in px: only the sides it crosses. */
export function pastBy(box: Box, frame: Box): Partial<Record<'left' | 'top' | 'right' | 'bottom', number>> {
  const out: Partial<Record<'left' | 'top' | 'right' | 'bottom', number>> = {};
  if (frame.l - box.l > SLACK) out.left = round(frame.l - box.l);
  if (frame.t - box.t > SLACK) out.top = round(frame.t - box.t);
  if (box.r - frame.r > SLACK) out.right = round(box.r - frame.r);
  if (box.b - frame.b > SLACK) out.bottom = round(box.b - frame.b);
  return out;
}

export function pastFrame(seen: Seen[]): Check[] {
  return seen.flatMap((s) => {
    if (!s.frame) return [];
    const by = Object.entries(pastBy(s.box, s.frame));
    if (!by.length) return [];
    const where = s.frame_is === 'land' ? 'its island’s land' : 'the frame';
    return [{ rule: 'past_frame' as const, mark: s.mark, said: `${name(s)} runs ${by.map(([side, px]) => `${px} px past the ${side}`).join(', ')} of ${where}` }];
  });
}

export function smallText(seen: Seen[], least = LEAST_PX): Check[] {
  return seen.filter((s) => s.px !== undefined && s.px > 0 && s.px < least - 0.05).map((s) => ({ rule: 'small_text' as const, mark: s.mark, said: `${name(s)} is drawn at ${round(s.px!)} px, under ${least}` }));
}

export function wrappedRow(seen: Seen[]): Check[] {
  return seen.filter((s) => s.one_line && (s.lines ?? 1) > 1).map((s) => ({ rule: 'wrapped_row' as const, mark: s.mark, said: `${name(s)} wraps onto ${s.lines} lines` }));
}

/** How far two boxes overlap each way, in px: both above a pixel's rounding is an overlap. */
const overlaps = (a: Box, b: Box) => Math.min(a.r, b.r) - Math.max(a.l, b.l) > SLACK && Math.min(a.b, b.b) - Math.max(a.t, b.t) > SLACK;

/** A mark of one island that lies over another island's land: each told once, by the first island it covers. */
export function onIsland(seen: Seen[], lands: Land[] = []): Check[] {
  return seen.flatMap((s) => {
    if (!s.island) return [];
    const other = lands.find((l) => l.island !== s.island && l.rects.some((r) => overlaps(s.box, r)));
    return other ? [{ rule: 'on_island' as const, mark: s.mark, said: `${name(s)} of ${s.island} lies over ${other.island}’s land` }] : [];
  });
}

/** At most MOST of one rule, the last saying how many more there were. */
export function capped(checks: Check[], most = MOST): Check[] {
  if (checks.length <= most) return checks;
  const kept = checks.slice(0, most - 1), rest = checks.length - kept.length;
  return [...kept, { rule: checks[0].rule, said: `and ${rest} more like it` }];
}

/** Every check a probe fails, each rule's capped: empty when nothing fails. */
export function checksOf(probe: Probe | null | undefined): Check[] {
  const seen = probe?.seen ?? [];
  return [...capped(pastFrame(seen)), ...capped(smallText(seen)), ...capped(wrappedRow(seen)), ...capped(onIsland(seen, probe?.lands))];
}

/**
 * The probe, as an expression evaluated in the drawn page: what each visible element with text of its own, or that
 * stands for an item, is as drawn. At most READ elements are read, the canvas's first; plain data comes back.
 */
export const PROBE = `(() => {
  const READ = 4000, vw = innerWidth, vh = innerHeight;
  const box = (r) => ({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  const own = (el) => [...el.childNodes].filter((c) => c.nodeType === 3 && c.textContent.trim());
  const label = (el) => {
    const item = el.closest('[data-item]')?.dataset.item;
    const cls = typeof el.className === 'string' ? el.className : el.className?.baseVal ?? '';
    const named = el.tagName.toLowerCase() + cls.split(/\\s+/).filter(Boolean).slice(0, 2).map((c) => '.' + c).join('');
    return item ? named + '[' + item + ']' : named;
  };
  const words = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const shown = (el, st) => st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0;
  // A box that clips or scrolls what is in it: what runs past it is cut, and the box itself is what is checked.
  const clips = (st) => /hidden|auto|scroll|clip/.test(st.overflowX) || /hidden|auto|scroll|clip/.test(st.overflowY);
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) if (clips(getComputedStyle(p))) return true; return false; };
  // Each island's land, its rects as drawn, and its name: the name its header says, else its place among them.
  const regions = [...document.querySelectorAll('.lf-region')];
  const landRects = (region) => [...region.querySelectorAll(':scope > .lf-land rect:not(.lf-spot), :scope > .lf-land:not(:has(rect))')].map((r) => r.getBoundingClientRect()).filter((r) => r.width > 1 && r.height > 1);
  const lands = new Map(regions.map((region, n) => [region, { island: (region.querySelector('.lf-island-name text, text.lf-island-name')?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40) || 'island ' + (n + 1), rects: landRects(region).map(box) }]));
  const landOf = (el) => {
    const land = lands.get(el.closest('.lf-region'));
    if (!land?.rects.length) return null;
    const rs = land.rects;
    return { l: Math.min(...rs.map((r) => r.l)), t: Math.min(...rs.map((r) => r.t)), r: Math.max(...rs.map((r) => r.r)), b: Math.max(...rs.map((r) => r.b)) };
  };
  // Meant as one line: a row by its class, one that says so, or one that cuts its text with an ellipsis.
  const oneLine = (el, st) => !(el instanceof SVGElement) && (el.hasAttribute('data-one-line') || /(^|[\\s-])row($|\\s)/.test(typeof el.className === 'string' ? el.className : '') || st.textOverflow === 'ellipsis');
  // The lines its text takes: each text in it, each line of each, by where its top is.
  const lineCount = (el) => {
    const tops = [], walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let t = walk.nextNode(); t; t = walk.nextNode()) {
      if (!t.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(t);
      for (const r of range.getClientRects()) if (r.width && r.height && !tops.some((y) => Math.abs(y - r.top) < r.height / 2)) tops.push(r.top);
    }
    return Math.max(1, tops.length);
  };
  const scaleOf = (el) => {
    if (el instanceof SVGElement) { const m = el.getScreenCTM(); return m ? Math.hypot(m.a, m.b) : 1; }
    const w = el.offsetWidth; return w ? el.getBoundingClientRect().width / w : 1;
  };
  const canvas = document.querySelector('#canvas');
  const all = [...(canvas ? canvas.querySelectorAll('*') : []), ...[...document.body.querySelectorAll('*')].filter((el) => !canvas || !canvas.contains(el))];
  const seen = [];
  for (const el of all) {
    if (seen.length >= READ) break;
    if (/^(script|style|title|defs|clippath|lineargradient|radialgradient|stop|template)$/i.test(el.tagName)) continue;
    if (el.closest('.lf-land, .lf-shore, [aria-hidden="true"], [hidden]')) continue;
    const texts = own(el), item = el.dataset?.item, st = getComputedStyle(el), one = oneLine(el, st);
    if (!texts.length && !item && !one) continue;
    if (!shown(el, st)) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const s = { mark: label(el), box: box(r) };
    const text = words(el); if (text) s.text = text;
    const land = landOf(el);
    if (land) { s.frame = land; s.frame_is = 'land'; s.island = lands.get(el.closest('.lf-region')).island; }
    else if (!(canvas && canvas.contains(el)) && !clipped(el) && st.position !== 'fixed') { s.frame = { l: 0, t: -1e9, r: vw, b: 1e9 }; s.frame_is = 'viewport'; }
    if (texts.length) s.px = parseFloat(st.fontSize) * scaleOf(el);
    if (one) { s.one_line = true; s.lines = lineCount(el); }
    seen.push(s);
  }
  return { width: vw, height: vh, seen, lands: [...lands.values()].filter((l) => l.rects.length) };
})()`;
