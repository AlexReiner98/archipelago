// What the app's pages may load and who may frame them: the content policies the server sends with each.

// The page itself: its own script and stylesheet, this server, the frame a layout's code is drawn in, and a web page an agent shows in a pane (ui/pane-web.js): any https address, plain http on this machine only.
export const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' https: http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** A document's preview, which this server's own page may frame, to read drafts on the canvas (ui/reader-frame.js). */
export const PREVIEW_POLICY = PAGE_POLICY.replace(" https: http://localhost:* http://127.0.0.1:*", '').replace("frame-ancestors 'none'", "frame-ancestors 'self'");
/** A public page (/p/): loads its own scripts and styles, talks only to this server, frames only the sandbox its pictures are drawn in, and is never framed. */
export const PUBLIC_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** A published document's page, which this server's own page may also frame, to read it on the canvas (ui/reader-frame.js). */
export const READER_POLICY = PUBLIC_POLICY.replace("frame-ancestors 'none'", "frame-ancestors 'self'");
/** The same page read by someone signed in (/read/), to print or save: its pictures may also come as data. */
export const SIGNED_IN_READER_POLICY = READER_POLICY.replace("img-src 'self'", "img-src 'self' data:");
// The frame a layout's code runs in. `sandbox` gives it an origin of its own, so it has no way to the page's token or storage, cannot open
// windows or move the page, and `connect-src 'none'` with no outside source for anything leaves it nowhere to send what it is shown.
// It does not say who may frame it: sandboxed, it has no origin for 'self' to match, and framed by a stranger it is an empty page that can reach nothing.
const DRAW_POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'self' blob: data:; worker-src blob: data:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; webrtc 'block'; base-uri 'none'; form-action 'none'";
// The same frame opened (draw.html?open=1), asked for by the page only where the owner turned the sandbox off for drawings
// (drawings_open, src/workspace-tools.ts): no wall, the network, fonts, files and links, and the page's own origin. Only this
// server's page may frame it, so a stranger's page cannot hand it code to run as the person signed in here.
const OPEN_DRAW_POLICY = "frame-ancestors 'self'";

/**
 * The policy draw.html is served with: opened, or sandboxed (and on a dev server started PELAGO_UNSANDBOXED=1, without
 * the sandbox but with the rest). Its own scripts, written into it (src/ui-files.ts drawPage), are allowed by their
 * hashes, and no other script written in a page is. At the drawing host (src/draw-host.ts), framed by the pages it names.
 */
export function drawPolicy(open: boolean, unsandboxed: boolean, hashes: string[] = [], framedBy?: string[]): string {
  if (open) return OPEN_DRAW_POLICY;
  const policy = DRAW_POLICY.replace("script-src 'self' blob: data:", ["script-src 'self' blob: data:", ...hashes.map((h) => `'sha256-${h}'`)].join(' '));
  if (framedBy?.length) return hosted(policy, framedBy);
  return unsandboxed ? policy.replace('sandbox allow-scripts; ', '') : policy;
}

// At the drawing host the frame keeps an origin of its own, that host's and never the page's, so it may register a service
// worker and start workers from its own files. Only the pages it names may frame it: framed by its own origin it would be
// the page's, which is why 'self' is never one of them (and the page refuses to frame its own origin so, ui/base.js).
const hosted = (policy: string, framedBy: string[]) =>
  `${policy.replace('sandbox allow-scripts;', 'sandbox allow-scripts allow-same-origin;').replace('worker-src blob: data:', "worker-src 'self' blob: data:")}; frame-ancestors ${framedBy.join(' ')}`;

/** A page a secret opens (a link's) asks not to be indexed in its markup, as its header does: either may be all a crawler reads. */
export const unlisted = (html: string) => (html.includes('name="robots"') ? html : html.replace('<head>', '<head>\n    <meta name="robots" content="noindex" />'));
/** A page marked as it is served: with no sandbox for its drawing frames (ui/base.js frameSandbox), and draw.html as opened (ui/draw.js). */
export const markPage = (html: string, { open = false, unsandboxed = false, drawOrigin }: { open?: boolean; unsandboxed?: boolean; drawOrigin?: string }) => {
  const marked = html.replace('<html', `<html${unsandboxed ? ' data-draw-sandbox="off"' : ''}${open ? ' data-draw-open="on"' : ''}${drawOrigin ? ` data-draw-origin="${drawOrigin}"` : ''}`);
  // The frame the page starts with (ui/index.html), at the drawing host: the same frame ui/layout.js would make.
  return drawOrigin ? marked.replace(/sandbox="allow-scripts" src="\/draw\.html(\?v=\w+)?"/, (_, v = '') => `sandbox="allow-scripts allow-same-origin" src="${drawOrigin}/draw.html${v}"`) : marked;
};
