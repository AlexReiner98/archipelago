// Waiting in a test: for a condition, never for a guess at how long something takes. `until` asks again and again
// until what it asks holds or the time is up; `wait` is only for a test about time passing itself, and says why.

/** A pause of ms: only where the test is about time passing (a timer, an age), with a comment saying so. */
export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Whether `ok` came to hold within `ms`, asked every `every` ms (and once more at the end). */
export async function until(ok: () => unknown, ms = 20_000, every = 50): Promise<boolean> {
  for (const end = Date.now() + ms; Date.now() < end; await wait(every)) if (await ok()) return true;
  return Boolean(await ok());
}
