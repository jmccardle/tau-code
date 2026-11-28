/**
 * Eight random hex digits, for the part of a client id that tells one tab or panel from another.
 * `crypto.getRandomValues`, not `crypto.randomUUID`: a browser withholds `randomUUID` (and
 * `crypto.subtle`) from a page that is not a secure context, such as plain http on a LAN address,
 * and the page would not start. `getRandomValues` is there in every context.
 */
export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, '0')).join('');
}
