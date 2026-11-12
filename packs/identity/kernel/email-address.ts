// An email address as this server keeps one: no sending here, so who only compares addresses (members, the walls' mail
// gate) needs no mail. The identity root's: a member is an address. The mailer pack keeps its own copy, as a service
// pack imports nothing of the kernel.

const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[^\s@<>()",;:]+$/;
/** An email address as it is kept and compared: trimmed and in lower case. Undefined when it is not one. */
export function normalEmail(email: unknown): string | undefined {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  return EMAIL.test(e) && e.length <= 254 ? e : undefined;
}
