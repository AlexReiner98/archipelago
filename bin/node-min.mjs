/** The oldest Node that runs Archipelago: TypeScript without a build, and node:sqlite. Plain JavaScript, read before any TypeScript runs. */
export const NODE_MIN = [22, 18];

/** Whether a Node version (`22.18.0`) is new enough. */
export function newEnough(version, min = NODE_MIN) {
  const [major = 0, minor = 0] = String(version).split(".").map(Number);
  return major > min[0] || (major === min[0] && minor >= min[1]);
}
