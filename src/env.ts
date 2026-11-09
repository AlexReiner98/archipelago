/** A setting from the environment (PELAGO_ and the name). */
export const env = (name: string): string | undefined => process.env[`PELAGO_${name}`];
