// The server's policy on agents' changes (pelago.config.json `policy`): who may change what unasked. Identity answers it
// (docs/kernel-packs.md, "The root packs", 4); it is read with the rest of the server's configuration by the database
// root (packs/database/kernel/config-words.ts), so the config is read without asking above itself.

export { serverPolicy } from '../../database/kernel/config-words.ts';
