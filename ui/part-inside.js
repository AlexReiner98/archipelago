// What runs in a pack version's worker, around its parts' code: written into the frame's script after draw-inside.js
// (packs/surface/kernel/ui-files.ts), and handed to the frame's workers as text with it (ui/draw-marks.js). Not a module.
'use strict';

/**
 * The parts of one pack version, in a worker of the frame's. The frame hands it the version's modules and one end of a
 * channel whose other end it gives the page (ui/draw-parts.js): from then on the page and the parts talk on it alone.
 *
 * The page says: mount { id, part, input }, update { id, input }, event { id, event }, unmount { id }, and
 * acted { asked, ... } (what came of an action). The parts say: marks { id, marks }, act { id, asked, action, params }
 * and error { id?, message }. A part is `parts[name](input, tools)` from the version's index.js, answering
 * { marks, update?(input), on?(event), end?() }, where update and on may answer new marks. The page checks every word.
 */
function partInside() {
  const text = (err) => String(err?.message ?? err).slice(0, 300);
  // The version's modules, entered at index.js; one imports another as './name.js', as a drawing's do (ui/draw-inside.js).
  const load = (modules, asUrl) => {
    const urls = new Map(), on = new Set();
    const urlOf = (name) => {
      if (urls.has(name)) return urls.get(name);
      if (typeof modules[name] !== 'string') throw new Error(`The pack imports "${name}", which it does not have`);
      if (on.has(name)) throw new Error(`The pack's modules import each other in a ring, at "${name}"`);
      on.add(name);
      const code = modules[name].replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])\.\/([\w.-]+\.js)\2/g, (_, before, q, dep) => `${before}${q}${urlOf(dep)}${q}`);
      urls.set(name, asUrl(code));
      return urls.get(name);
    };
    return import(urlOf('index.js'));
  };
  const blob = (code) => URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  const data = (code) => `data:text/javascript;base64,${btoa(String.fromCharCode(...new TextEncoder().encode(code)))}`;

  let parts, port;
  const mounted = new Map();
  const asked = new Map();
  let asks = 0;
  // What cannot be sent (a function, a node) is an error of the part's, not a worker that stops answering.
  const send = (message) => {
    try {
      port.postMessage(message);
    } catch (err) {
      port.postMessage({ type: 'error', id: message.id, message: text(err) });
    }
  };
  const marks = (id, said) => said !== undefined && mounted.has(id) && send({ type: 'marks', id, marks: said });
  const tools = (id) => ({
    // New marks of its own accord: a part that moves or has waited on something.
    marks: (said) => marks(id, said),
    // One of its pack's declared actions; the page checks it is, shows it as it goes out and answers what came of it.
    act: (action, params) => new Promise((resolve) => (asked.set(++asks, resolve), send({ type: 'act', id, asked: asks, action: String(action), params: params ?? {} }))),
  });

  // One part's words at a time, in the order they came: a part is never told of an event before it is mounted.
  let ready = Promise.resolve();
  const heard = (said) => {
    if (said.type === 'acted') return void (asked.get(said.asked)?.(said), asked.delete(said.asked));
    const id = String(said.id);
    ready = ready.then(async () => {
      try {
        if (said.type === 'mount') {
          const make = parts?.[said.part];
          if (typeof make !== 'function') throw new Error(`This pack has no part "${String(said.part).slice(0, 60)}"`);
          mounted.set(id, null);
          const made = await make(said.input, tools(id));
          if (!mounted.has(id)) return void made?.end?.();
          mounted.set(id, made);
          marks(id, made?.marks);
        } else if (said.type === 'update' && mounted.get(id)?.update) marks(id, await mounted.get(id).update(said.input));
        else if (said.type === 'event' && mounted.get(id)?.on) marks(id, await mounted.get(id).on(said.event));
        else if (said.type === 'unmount') (mounted.get(id)?.end?.(), mounted.delete(id));
      } catch (err) {
        send({ type: 'error', id, message: text(err) });
      }
    });
  };

  // From the frame: the version's code and the page's channel, once. Pings are answered by draw-inside.js beside this.
  self.addEventListener('message', async (ev) => {
    const said = ev.data ?? {};
    if (said.type !== 'parts' || port || !ev.ports[0]) return;
    port = ev.ports[0];
    const t0 = performance.now();
    try {
      const made = await load(said.modules, blob).catch(() => load(said.modules, data));
      parts = made.parts ?? made.default;
      if (!parts || typeof parts !== 'object') throw new Error('A pack version must export its parts: export const parts = { name(input, tools) { return { marks }; } }');
      port.onmessage = (e) => heard(e.data ?? {});
      self.postMessage({ type: 'loaded', took: performance.now() - t0 });
    } catch (err) {
      self.postMessage({ type: 'error', message: text(err) });
    }
  });
}
