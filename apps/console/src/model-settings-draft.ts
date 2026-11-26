import type { ModelOverrides, OperatorModelsResponse } from '@oddmash/agent-operator-contract';

export function reconcileModelDraft(latest: OperatorModelsResponse, draft: ModelOverrides, discard: boolean) {
  return { saved: latest, draft: discard ? latest.overrides : draft, needsReview: !discard };
}
