/** The phases a workspace opens in, in order. Kept apart from boot.ts, the entry module, so a module boot loads
 *  can read them without importing boot while its top-level await is still running (which hangs `npm start`). */
export const OPEN_PHASES = ['restore', 'packs', 'types', 'begin', 'islands', 'ready'] as const;
