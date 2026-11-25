import type { ControlsRecord, OperatorControls } from '@oddmash/agent-operator-contract';

export function reviewRetainedDraft(latest: ControlsRecord, draft: OperatorControls) {
  return { saved: latest, draft, needsReview: true };
}
