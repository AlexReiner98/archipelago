// Moved to packs/connect/kernel/connection-tools.ts (docs/kernel-packs.md, "Where each module goes"): the tool is
// declared there with its input as a JSON shape, run on the connect pack's context (the surface builds its schema and
// hands its run the context src/token-ask.ts makes). This shim keeps its importers working until the gather step.
export * from '../packs/connect/kernel/connection-tools.ts';
