// Where the app's parts run, in the frame draw.html makes (draw.js has the walls): one worker for each pack version on
// screen, not one for each part, its parts' code given as text (ui/part-inside.js runs around it). Written into the
// frame's script after draw-marks.js, whose warm worker it takes.
'use strict';

// The frame starts a version's worker and hands the page one end of a channel to it (part-port, the version named);
// nothing goes through the frame after that, so the page knows which pack version speaks by the port alone (decision
// e_xeqhcums), and two versions of one pack on one screen are two workers that cannot see each other. The walls are
// the drawings': the frame has no origin of the page's and may send nothing anywhere, the worker has no page.
//
// The page says: part-load { version, modules } and part-end { version }. The frame says: part-port { version } with
// the port, part-failed { version, message } and part-stopped { version, message }.

(() => {
  const say = (message, transfer) => parent.postMessage(message, '*', transfer);
  /** Each pack version's worker, by its name. */
  const versions = new Map();
  const end = (version) => (versions.get(version)?.worker?.terminate(), versions.delete(version));
  const failed = (version, message) => (end(version), say({ type: 'part-failed', version, message: String(message).slice(0, 300) }));

  const load = (version, modules) => {
    if (versions.has(version)) return;
    const v = { worker: null, unanswered: 0 };
    versions.set(version, v);
    self.takeWorker().then(
      (worker) => {
        if (versions.get(version) !== v) return void worker.terminate();
        v.worker = worker;
        const { port1, port2 } = new MessageChannel();
        worker.onmessage = ({ data: said }) => {
          v.unanswered = 0;
          if (said?.type === 'loaded') say({ type: 'part-port', version, took: Number(said.took) || 0 }, [port2]);
          else if (said?.type === 'error') failed(version, said.message);
        };
        worker.onerror = (err) => failed(version, err.message || 'The pack stopped.');
        worker.postMessage({ type: 'parts', modules }, [port1]);
      },
      (err) => failed(version, err.message),
    );
  };

  addEventListener('message', (ev) => {
    if (ev.source !== parent) return;
    const said = ev.data ?? {};
    if (typeof said.version !== 'string' || !/^[\w.:@/-]{1,160}$/.test(said.version)) return;
    if (said.type === 'part-load' && said.modules && typeof said.modules === 'object') load(said.version, said.modules);
    else if (said.type === 'part-end') end(said.version);
  });

  // A version that stops answering is ended, as a drawing is (ui/draw-marks.js): six pings unanswered, counted, not
  // timed, and none asked while the page is hidden.
  setInterval(() => {
    for (const [version, v] of versions) {
      if (!v.worker) continue;
      if (document.hidden) {
        v.unanswered = 0;
        continue;
      }
      if (v.unanswered++ < 6) {
        v.worker.postMessage({ type: 'ping' });
        continue;
      }
      end(version);
      say({ type: 'part-stopped', version, message: 'It did not answer for 12 seconds and was stopped.' });
    }
  }, 2000);
})();
