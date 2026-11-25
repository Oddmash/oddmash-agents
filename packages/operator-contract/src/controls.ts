export const optionalRoles = ['impact', 'qa', 'release', 'docs', 'architect'] as const;
export type OptionalRole = typeof optionalRoles[number];
export type OperatorControls = { paused: boolean; excludedRoles: OptionalRole[]; maxRequests: number | null; maxMs: number | null };
export type ControlsRecord = { revision: string | null; controls: OperatorControls; updatedAt: string | null };

export const defaultControls = (): OperatorControls => ({ paused: false, excludedRoles: [], maxRequests: null, maxMs: null });

export function parseOperatorControls(input: unknown): OperatorControls | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 4 || typeof value.paused !== 'boolean' || !Array.isArray(value.excludedRoles) ||
      value.excludedRoles.length > optionalRoles.length || value.excludedRoles.some(role => !optionalRoles.includes(role as OptionalRole)) ||
      new Set(value.excludedRoles).size !== value.excludedRoles.length) return;
  const bound = (number: unknown, max: number) => number === null || typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 && number <= max;
  if (!bound(value.maxRequests, 5) || !bound(value.maxMs, 120000)) return;
  return { paused: value.paused, excludedRoles: optionalRoles.filter(role => (value.excludedRoles as unknown[]).includes(role)), maxRequests: value.maxRequests as number | null, maxMs: value.maxMs as number | null };
}

export function parseControlsRecord(input: unknown): ControlsRecord | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  const controls = parseOperatorControls(value.controls);
  if (!controls || typeof value.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(value.revision) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return;
  return { revision: value.revision, controls, updatedAt: value.updatedAt };
}

export function restrictAdvisoryBudget(base: { maxRequests: number; elapsedMs: number }, controls: OperatorControls) {
  return {
    maxRequests: controls.paused ? 0 : Math.min(base.maxRequests, controls.maxRequests ?? base.maxRequests),
    elapsedMs: controls.paused ? 0 : Math.min(base.elapsedMs, controls.maxMs ?? base.elapsedMs)
  };
}
