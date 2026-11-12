// Moved to packs/automation_triggers/kernel/automation-rules.ts (docs/kernel-packs.md, "Moving a service in the wave"):
// this shim keeps its importers (the write path's automation check, the clock's query edges, the launch on due)
// working until the gather step rewrites them.
export * from '../packs/automation_triggers/kernel/automation-rules.ts';
