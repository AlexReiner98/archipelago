// What this browser keeps of whoever is signed in, let go when they sign out or another signs in (the token set in
// ./base.js): what one person was shown is never there for the next.

/** Where this browser keeps the pictures it drew (packs/walls/page/pictures-kept.js): what a person was shown. */
export const PICTURES_KEPT = 'pelago-pictures';
/** Said on the page when whoever is signed in changes or signs out (`SIGNED_IN`): what it holds of them is let go. */
export const SIGNED_IN = 'pelago-signed-in';
/**
 * Signed out, or signed in as another: nothing kept of what the last person was shown stays in this browser for the
 * next. The pictures kept are deleted, and the page told, so it lets go of those it holds and of the store first.
 */
export function forgetSignedIn() {
  try {
    dispatchEvent(new Event(SIGNED_IN));
    indexedDB.deleteDatabase(PICTURES_KEPT);
  } catch {
    // Storage refused: nothing was kept.
  }
}
