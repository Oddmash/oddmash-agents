export const optionalRoles = ['impact', 'qa', 'release', 'docs', 'architect'] as const;
export const primaryRoles = ['reviewer', 'triage'] as const;
export const controllableRoles = [...optionalRoles, ...primaryRoles] as const;
export type ControllableRole = typeof controllableRoles[number];
export type OptionalRole = typeof optionalRoles[number];
export type OperatorControls = { paused: boolean; excludedRoles: ControllableRole[]; maxRequests: number | null; maxMs: number | null };
export type ControlsRecord = { revision: string | null; controls: OperatorControls; updatedAt: string | null };
export type DeploymentControlLimits = { maxRequests: number; maxMs: number };
export type ControlsResponse = ControlsRecord & { limits: DeploymentControlLimits };

const boundedLimit = (value: string | undefined, fallback: number, maximum: number) => {
  if (value === undefined || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, maximum) : fallback;
};

export function deploymentControlLimits(env: Readonly<Record<string, string | undefined>>): DeploymentControlLimits {
  return { maxRequests: boundedLimit(env.REVIEWER_AUTO_ADVISORY_MAX_REQUESTS, optionalRoles.length, optionalRoles.length), maxMs: boundedLimit(env.REVIEWER_AUTO_ADVISORY_MAX_MS, 90_000, 120_000) };
}

export function withinDeploymentControlLimits(controls: OperatorControls, limits: DeploymentControlLimits): boolean {
  return (controls.maxRequests === null || controls.maxRequests <= limits.maxRequests) && (controls.maxMs === null || controls.maxMs <= limits.maxMs);
}

export const defaultControls = (): OperatorControls => ({ paused: false, excludedRoles: [], maxRequests: null, maxMs: null });

export function parseOperatorControls(input: unknown): OperatorControls | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 4 || typeof value.paused !== 'boolean' || !Array.isArray(value.excludedRoles) ||
      value.excludedRoles.length > controllableRoles.length || value.excludedRoles.some(role => !controllableRoles.includes(role as ControllableRole)) ||
      new Set(value.excludedRoles).size !== value.excludedRoles.length) return;
  const bound = (number: unknown, max: number) => number === null || typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 && number <= max;
  if (!bound(value.maxRequests, 5) || !bound(value.maxMs, 120000)) return;
  return { paused: value.paused, excludedRoles: controllableRoles.filter(role => (value.excludedRoles as unknown[]).includes(role)), maxRequests: value.maxRequests as number | null, maxMs: value.maxMs as number | null };
}

export function parseControlsRecord(input: unknown): ControlsRecord | undefined {
  if (!input || typeof input !== 'object') return;
  const value = input as Record<string, unknown>;
  const controls = parseOperatorControls(value.controls);
  if (!controls || typeof value.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(value.revision) ||
      typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) return;
  const paused = value.pausedPrimaryRoles;
  if (paused !== undefined && (!Array.isArray(paused) || paused.some(role => !primaryRoles.includes(role)) || new Set(paused).size !== paused.length)) return;
  const excludedRoles = controllableRoles.filter(role => controls.excludedRoles.includes(role) || (Array.isArray(paused) && paused.includes(role)));
  return { revision: value.revision, controls: { ...controls, excludedRoles }, updatedAt: value.updatedAt };
}

export function restrictAdvisoryBudget(base: { maxRequests: number; elapsedMs: number }, controls: OperatorControls) {
  return {
    maxRequests: controls.paused ? 0 : Math.min(base.maxRequests, controls.maxRequests ?? base.maxRequests),
    elapsedMs: controls.paused ? 0 : Math.min(base.elapsedMs, controls.maxMs ?? base.elapsedMs)
  };
}
