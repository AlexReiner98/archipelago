// The member table's later steps (src/migrate.ts). A member who only reads (the owner, 10-11 Nov 2026, decision
// e_nwdn7ce6) sees what any member sees, and their requests run in a read-only transaction (src/db.ts scoped), so the
// database refuses every write of theirs whatever the page draws.

/** Step 40: a member may be one who only reads. */
export const MEMBER_READ_ONLY = `alter table member add column if not exists read_only boolean not null default false;`;
