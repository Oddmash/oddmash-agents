import type { AgentRole, JobState } from '@oddmash/agent-operator-contract';
import { translate, type Language, type Message } from './i18n.ts';

const tones = {
  queued: 'warning',
  running: 'active',
  returned: 'success',
  failed: 'danger',
  stale: 'warning'
} as const;

export const executionTone = (state: JobState) => tones[state];

export function executionLabel(language: Language, state: JobState, role?: AgentRole): string {
  const label: Message = state === 'returned'
    ? role === 'triage' ? 'Issue triage completed' : role === 'reviewer' ? 'Review handling completed' : 'Processing completed'
    : state === 'failed' ? 'Processing failed'
    : state === 'running' ? 'Running' : state === 'queued' ? 'Queued' : 'Stale observations';
  return translate(language, label);
}
