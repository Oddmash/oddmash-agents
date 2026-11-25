export function isAuthorizedOwner(id: unknown, expected: unknown): boolean {
  return typeof expected === 'string' && /^[1-9]\d*$/.test(expected) && (typeof id === 'string' || typeof id === 'number') && String(id) === expected;
}
