// Moved to packs/log/kernel/eventlog.ts (wave 6): the activity log is read from the log, by the roots that hold a
// database or a transaction (backup's dump, the surface's reads), so it is the log root's. This shim keeps its
// importers working until the gather step rewrites them.
export * from '../packs/log/kernel/eventlog.ts';
