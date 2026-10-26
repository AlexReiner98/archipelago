// Presets: a whole setup kept by name in this browser, and carried between browsers as a JSON file.
// What a setup holds is the page's business (capture and apply); here is only where they are kept.

const KEY = 'archipelago-ridges-presets';

/** Every kept preset, by name. Empty if this browser keeps nothing, or will not let us look. */
export function all() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

function write(presets) {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

/** Keep a setup under a name, replacing one of the same name. Answers whether the browser kept it. */
export const keep = (name, setup) => write({ ...all(), [name]: { ...setup, saved: new Date().toISOString() } });

export const remove = (name) => {
  const presets = all();
  delete presets[name];
  return write(presets);
};

/** All presets as a file's text, to download. */
export const exported = () => JSON.stringify({ kind: 'archipelago-ridges-presets', v: 1, presets: all() }, null, 2);

/** Presets from a file's text, added to those kept (a name already kept is replaced). Answers how many came in. */
export function imported(text) {
  const file = JSON.parse(text);
  const incoming = file?.kind === 'archipelago-ridges-presets' ? file.presets : null;
  if (!incoming || typeof incoming !== 'object') throw new Error('Not a presets file');
  write({ ...all(), ...incoming });
  return Object.keys(incoming).length;
}
