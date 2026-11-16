// The pictures this browser drew, kept across reloads: each scene a drawing answered, in the browser's own storage
// (IndexedDB), by the picture's name (./picture-name.js), apart for each person in each workspace. A page opened
// again mounts a picture drawn before from the same without laying it out (packs/walls/page/layout.js). What comes
// back is trusted no more than a drawing: it is mounted through the same checks as every scene (./marks.js), and
// one that fails them is laid out instead. Bounded in count and characters for each scope; a drawing whose code
// changed has its pictures dropped. Storage refused (a private window, blocked site data) keeps nothing, and the
// page draws as it would without it.

/**
 * The pictures this page drew lately: each scene a drawing answered, by a name of all it was drawn from
 * (./picture-name.js). A picture is its answer, style, code and room alone, so one asked again from the same (a canvas
 * gone back to, a view switched back) is mounted from what was kept, and its drawing is not run until the picture
 * needs it (`begin` in ./layout.js). At most `keeping.most`, weighing `keeping.weight` characters; across reloads,
 * `keptPictures` (below).
 */
export const scenes = new Map();
const keeping = { most: 24, weight: 2 ** 25, held: 0 };
export function keepScene(key, scene, weight) {
  if (scenes.has(key)) keeping.held -= scenes.get(key).weight;
  scenes.delete(key);
  scenes.set(key, { scene, weight });
  keeping.held += weight;
  for (const [old, one] of scenes) {
    if (scenes.size <= keeping.most && keeping.held <= keeping.weight) break;
    scenes.delete(old);
    keeping.held -= one.weight;
  }
}

const DB = 'pelago-pictures';
const NAMES = 'names', SCENES = 'scenes';
/** How many pictures a scope keeps, and how many characters of scene in all. */
export const storing = { most: 48, weight: 2 ** 24 };

let opened;
/** The database, or null where storage is refused. */
function db() {
  opened ??= new Promise((resolve) => {
    try {
      const asked = indexedDB.open(DB, 1);
      asked.onupgradeneeded = () => {
        const made = asked.result;
        made.createObjectStore(NAMES, { keyPath: 'id' }).createIndex('scope', 'scope');
        made.createObjectStore(SCENES, { keyPath: 'id' });
      };
      // One made by something else under this name, without the stores, is not used.
      asked.onsuccess = () => (asked.result.objectStoreNames.contains(NAMES) && asked.result.objectStoreNames.contains(SCENES) ? resolve(asked.result) : (asked.result.close(), resolve(null)));
      asked.onerror = asked.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opened;
}

const done = (req) => new Promise((resolve, reject) => ((req.onsuccess = () => resolve(req.result)), (req.onerror = () => reject(req.error))));
const ended = (tx) => new Promise((resolve, reject) => ((tx.oncomplete = resolve), (tx.onerror = tx.onabort = () => reject(tx.error))));

/**
 * What this browser keeps for one scope (`scope`: a promise of the person and workspace, or of null where the page is
 * not signed in): the names it holds are read once, so a picture it does not hold is known at once and laid out
 * with no wait.
 */
export function keptPictures(scope) {
  let names = null;
  const read = Promise.resolve(scope).then(async (who) => {
    const base = who && (await db());
    if (!base) return null;
    const rows = await done(base.transaction(NAMES).objectStore(NAMES).index('scope').getAll(who));
    names = new Map(rows.map((r) => [r.name, r]));
    return { base, who };
  }).catch(() => null).then((at) => {
    // Where nothing can be kept, nothing is held: a picture is laid out with no wait.
    if (!at) names = new Map();
    return at;
  });

  /**
   * The scene kept under `name`: null where none is (known without waiting once the names are read), else a promise
   * of it, or of null where it cannot be read.
   */
  const find = (name) => {
    if (names && !names.has(name)) return null;
    return read.then(async (at) => {
      const row = at && names?.get(name);
      if (!row) return null;
      const got = await done(at.base.transaction(SCENES).objectStore(SCENES).get(row.id));
      const scene = got?.scene;
      if (!scene || typeof scene !== 'object' || Array.isArray(scene)) return null;
      // Used now: the last to be let go.
      row.at = Date.now();
      at.base.transaction(NAMES, 'readwrite').objectStore(NAMES).put(row);
      return scene;
    }).catch(() => null);
  };

  /** Keep `scene`, drawn by the drawing `drawing` (its id) whose code has `hash`, under `name`: when the page is idle. */
  const keep = (name, scene, drawing, hash) => {
    const idle = globalThis.requestIdleCallback ?? ((fn) => setTimeout(fn, 200));
    idle(() => void read.then(async (at) => {
      if (!at || !names) return;
      let weight;
      try {
        weight = JSON.stringify(scene).length;
      } catch {
        return;
      }
      if (weight > storing.weight) return;
      const row = { id: `${at.who}|${name}`, scope: at.who, name, drawing, hash, weight, at: Date.now() };
      const tx = at.base.transaction([NAMES, SCENES], 'readwrite');
      const [rows, scenes] = [tx.objectStore(NAMES), tx.objectStore(SCENES)];
      const drop = (old) => (rows.delete(old.id), scenes.delete(old.id), names.delete(old.name));
      // A drawing whose code changed draws other pictures: what its old code drew goes.
      for (const old of [...names.values()]) if (old.drawing === drawing && old.hash !== hash) drop(old);
      names.delete(name);
      rows.put(row);
      scenes.put({ id: row.id, scene });
      names.set(name, row);
      // The least lately used go first, until the scope is within its bounds.
      let held = [...names.values()].reduce((sum, r) => sum + r.weight, 0);
      for (const old of [...names.values()].sort((a, b) => a.at - b.at)) {
        if (names.size <= storing.most && held <= storing.weight) break;
        if (old.name === name) continue;
        drop(old);
        held -= old.weight;
      }
      await ended(tx);
    }).catch(() => {}));
  };

  return { find, keep };
}
