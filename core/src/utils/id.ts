/**
 * Tiny, dependency-free unique id generator.
 *
 * Uses the Web Crypto API when available (Node 19+, browsers, Electron) and
 * falls back to a timestamp+random scheme. Good enough for local primary keys.
 */
export function generateId(prefix = ''): string {
  const g = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) {
    const uuid = g.crypto.randomUUID();
    return prefix ? `${prefix}_${uuid}` : uuid;
  }
  const rand = Math.random().toString(36).slice(2, 10);
  const time = Date.now().toString(36);
  const id = `${time}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}
