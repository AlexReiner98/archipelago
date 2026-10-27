// A picture of what the canvas drew, made here, for an agent that showed the owner something and asked to see it
// (report show, look: true; src/looks.ts). It is drawn from the page as it stands: the canvas's marks and the page's
// stylesheets put into one image, each canvas painted in as the pixels it holds, and a style's own frame asked for
// its pixels (ui/style-code.js), since what runs there is never read from outside it. Nothing is drawn anywhere but in
// this browser. The page's own web fonts are not in the image: its text is set in the faces this system has.

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The most a picture weighs, in bytes, as the server takes one (src/pictures.ts); a larger one is made again smaller. */
const most = 1_000_000;

/** Settled: the canvas has drawn something, and nothing in it has changed for a while; at most `ms`. */
export async function drawnNow(host = document.getElementById('canvas'), ms = 12000) {
  const until = Date.now() + ms;
  let last = '', same = 0;
  await wait(300);
  while (Date.now() < until && same < 6) {
    await wait(120);
    const view = host.querySelector('.lens-view');
    const now = view && !view.querySelector(':scope > .empty') ? view.innerHTML : '';
    same = now && now === last ? same + 1 : 0;
    last = now;
  }
  // What a surface or a style's code paints comes after its marks.
  await wait(800);
}

/** Every rule the page is styled by, as text: its stylesheets and those its drawings adopted. */
function rules() {
  const sheets = [...document.styleSheets, ...document.adoptedStyleSheets];
  return sheets.map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
}

/** A canvas's pixels as an address, or null when it gives none. */
const pixels = (canvas) => { try { return canvas.toDataURL('image/png'); } catch { return null; } };

/** A bitmap as an address. */
function bitmapUrl(bitmap) {
  const c = document.createElement('canvas');
  Object.assign(c, { width: bitmap.width, height: bitmap.height });
  c.getContext('2d').drawImage(bitmap, 0, 0);
  return c.toDataURL('image/png');
}

/** The picture of what `host` (the canvas) shows now, as a PNG in base64, with its size. */
export async function pictureOf(host = document.getElementById('canvas')) {
  const box = host.getBoundingClientRect();
  const width = Math.round(box.width), height = Math.round(box.height);
  if (!width || !height) throw new Error('The canvas has no size on this page.');
  // What holds pixels, in the order the clone holds it too: each canvas as it is, each style's frame as it says.
  const sources = [...host.querySelectorAll('canvas, iframe')];
  const shown = await Promise.all(sources.map(async (el) => (el.tagName === 'CANVAS' ? pixels(el) : el.closest('.lens-view')?.capture ? el.closest('.lens-view').capture().then((b) => b && bitmapUrl(b)).catch(() => null) : null)));
  const clone = host.cloneNode(true);
  [...clone.querySelectorAll('canvas, iframe')].forEach((el, n) => {
    const r = sources[n].getBoundingClientRect();
    const img = document.createElement('img');
    for (const name of ['class', 'style']) if (el.getAttribute(name)) img.setAttribute(name, el.getAttribute(name));
    Object.assign(img.style, { width: `${r.width}px`, height: `${r.height}px` });
    if (shown[n]) img.setAttribute('src', shown[n]);
    el.replaceWith(img);
  });
  // The page's own variables and face are on its root and body; here they are on the picture's.
  const page = getComputedStyle(document.body);
  const holder = document.createElement('div');
  holder.setAttribute('style', `${document.documentElement.style.cssText};position:relative;width:${width}px;height:${height}px;overflow:hidden;font:${page.font};color:${page.color};background:${page.backgroundColor}`);
  const css = document.createElement('style');
  css.textContent = rules();
  holder.append(css, clone);
  const markup = new XMLSerializer().serializeToString(holder);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${markup}</foreignObject></svg>`;
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    const out = document.createElement('canvas');
    Object.assign(out, { width: Math.round(width * scale), height: Math.round(height * scale) });
    const ctx = out.getContext('2d');
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const data = out.toDataURL('image/png').split(',')[1];
    if (data.length * 0.75 <= most) return { data, content_type: 'image/png', width: out.width, height: out.height };
  }
  throw new Error('The image of the canvas is too large to send.');
}
