// What the app's pages may load and who may frame them: the content policies the server sends with each.

// The page itself: its own script and stylesheet, this server, the frame a layout's code is drawn in, and a web page an agent shows in a pane (ui/pane-web.js): any https address, plain http on this machine only.
export const PAGE_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' https: http://localhost:* http://127.0.0.1:*; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
/** A document's preview, which this server's own page may frame, to read drafts on the canvas (ui/reader-frame.js). */
export const PREVIEW_POLICY = PAGE_POLICY.replace(" https: http://localhost:* http://127.0.0.1:*", '').replace("frame-ancestors 'none'", "frame-ancestors 'self'");
// The frame a layout's code runs in. `sandbox` gives it an origin of its own, so it has no way to the page's token or storage, cannot open
// windows or move the page, and `connect-src 'none'` with no outside source for anything leaves it nowhere to send what it is shown.
// It does not say who may frame it: sandboxed, it has no origin for 'self' to match, and framed by a stranger it is an empty page that can reach nothing.
const DRAW_POLICY = "sandbox allow-scripts; default-src 'none'; script-src 'self' blob: data:; worker-src blob: data:; style-src 'unsafe-inline'; img-src data: blob:; connect-src 'none'; webrtc 'block'; base-uri 'none'; form-action 'none'";
// The same frame opened (draw.html?open=1), asked for by the page only where the owner turned the sandbox off for drawings
// (drawings_open, src/workspace-tools.ts): no wall, the network, fonts, files and links, and the page's own origin. Only this
// server's page may frame it, so a stranger's page cannot hand it code to run as the person signed in here.
const OPEN_DRAW_POLICY = "frame-ancestors 'self'";

/** The policy draw.html is served with: opened, or sandboxed (and on a dev server started PELAGO_UNSANDBOXED=1, without the sandbox but with the rest). */
export const drawPolicy = (open: boolean, unsandboxed: boolean) => (open ? OPEN_DRAW_POLICY : unsandboxed ? DRAW_POLICY.replace('sandbox allow-scripts; ', '') : DRAW_POLICY);

/** A page marked as it is served: with no sandbox for its drawing frames (ui/base.js frameSandbox), and draw.html as opened (ui/draw.js). */
export const markPage = (html: string, { open = false, unsandboxed = false }) => html.replace('<html', `<html${unsandboxed ? ' data-draw-sandbox="off"' : ''}${open ? ' data-draw-open="on"' : ''}`);
