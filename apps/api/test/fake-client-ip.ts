/**
 * A deterministic fake IPv4, distinct per input. Used to keep each e2e test's
 * rate-limit bucket separate from every other test's, the way distinct real
 * client devices would be in production.
 */
export function fakeClientIp(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `10.${(hash >>> 16) & 255}.${(hash >>> 8) & 255}.${hash & 255}`;
}
