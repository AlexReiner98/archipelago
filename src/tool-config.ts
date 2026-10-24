// What the server hands the tools when it starts: a way to back every workspace up now, and in dev mode a way to
// restart the process they run in.

let backUp: (() => Promise<unknown>) | undefined;
/** The server hands the tools a way to back every workspace up now. */
export function configureBackup(run: (() => Promise<unknown>) | undefined): void {
  backUp = run;
}
export const backupNow = () => backUp;

let restartServer: (() => void) | undefined;
/** Dev mode hands the tools a way to restart the process they run in. */
export function configureRestart(restart: (() => void) | undefined): void {
  restartServer = restart;
}
export const devMode = () => restartServer !== undefined;
export const restartNow = () => restartServer!();

/** A tool only a workspace's admin may call says so before it does anything. */
export function needAdmin(actor: { admin?: boolean }, what: string): void {
  if (!actor.admin) throw new Error(`Only a workspace admin can ${what}.`);
}
