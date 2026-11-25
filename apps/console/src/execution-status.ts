import type { AgentRole, JobState } from '@oddmash/agent-operator-contract';
import { translate, type Language, type Message } from './i18n.ts';

const tones = {
  queued: 'info',
  running: 'active',
  returned: 'success',
  failed: 'danger',
  stale: 'warning',
  skipped: 'neutral',
  published: 'success'
} as const;

export const executionTone = (state: JobState) => tones[state];

export function executionLabel(language: Language, state: JobState, role?: AgentRole): string {
  const label: Message = state === 'returned'
    ? role === 'triage' ? 'Issue triage completed' : role === 'reviewer' ? 'Review handling completed' : 'Processing completed'
    : state === 'failed' ? 'Processing failed'
    : state === 'running' ? 'Running' : state === 'queued' ? 'Queued'
    : state === 'skipped' ? 'Skipped' : state === 'published' ? 'Publication confirmed' : 'Stale observations';
  return translate(language, label);
}
