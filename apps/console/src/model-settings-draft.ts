import type { ModelOverrides, OperatorModelsResponse } from '@oddmash/agent-operator-contract';

export function reconcileModelDraft(latest: OperatorModelsResponse, draft: ModelOverrides, discard: boolean) {
  return { saved: latest, draft: discard ? latest.overrides : draft, needsReview: !discard };
}

export const modelSelectionAvailable = (allowed: readonly string[], current: string | undefined): boolean => allowed.length > 0 || Boolean(current);
