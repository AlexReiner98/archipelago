/**
 * What the key has turned off (a channel, the map's own, the harness's),
 * remembered by the browser as the key's being open is, so a view switch
 * or a reload keeps it.
 */
export const KEY_OFF = "harness.key-off";

/** The marks turned off, from what was stored: a JSON list of names; anything else, none. */
export function offOf(stored: string | null): Set<string> {
  try {
    const v: unknown = JSON.parse(stored ?? "[]");
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** The browser's stored value under `key`; none where storage is shut. */
export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores `value` under `key`; nothing where storage is shut. */
export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
