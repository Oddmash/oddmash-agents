import type { ControlsRecord, OperatorControls } from '@oddmash/agent-operator-contract';

export function reviewRetainedDraft(latest: ControlsRecord, draft: OperatorControls) {
  return { saved: latest, draft, needsReview: true };
}

export function displayLimit(value: number | null, fallback: number | undefined, scale = 1): number | '' {
  const effective = value ?? fallback;
  return effective !== undefined && Number.isFinite(effective) ? effective / scale : '';
}

export function validControlLimits(draft: OperatorControls, defaults: { maxRequests?: number; maxMs?: number }) {
  const valid = (value: number | null, fallback: number | undefined, hardCap: number) => value === null || Number.isSafeInteger(value) && value >= 0 && value <= Math.min(fallback ?? hardCap, hardCap);
  return valid(draft.maxRequests, defaults.maxRequests, 5) && valid(draft.maxMs, defaults.maxMs, 120000);
}

export function controlsDirty(saved: OperatorControls, draft: OperatorControls) {
  return saved.paused !== draft.paused || saved.maxRequests !== draft.maxRequests || saved.maxMs !== draft.maxMs || saved.excludedRoles.join(',') !== draft.excludedRoles.join(',');
}
