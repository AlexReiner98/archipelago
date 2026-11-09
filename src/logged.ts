// A failure that must not fail its caller is still said: where it happened and why, on the server's error stream.

/** A catch that says what failed, in what, and answers `fallback`: for work whose failure must not fail the work around it. */
export const logged =
  <T = undefined>(what: string, fallback?: T) =>
  (err: unknown): T => {
    console.error(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    return fallback as T;
  };
