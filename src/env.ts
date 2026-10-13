/** A setting from the environment (PELAGO_ and the name). The one it had while this was called Lattice is still read. */
export const env = (name: string): string | undefined => process.env[`PELAGO_${name}`] ?? process.env[`LATTICE_${name}`];
