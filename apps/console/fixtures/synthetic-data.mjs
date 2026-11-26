const repository = 'Oddmash/example';
const target = { repository, number: 42 };
const startedAt = '2026-01-01T12:00:00Z';
const observedAt = '2026-01-01T12:01:00Z';
const job = (role, state, extra = {}) => ({
  role, state, target, correlationId: 'fixture-' + role, attempt: 1,
  startedAt, updatedAt: observedAt, phase: 'reviewing', ...extra
});

export const status = {
  connected: true,
  jobs: [
    job('reviewer', 'failed', {
      finishedAt: observedAt, failure: 'unexpected', phase: 'validating',
      phaseHistory: [
        { phase: 'collecting-changes', timestamp: startedAt },
        { phase: 'validating', timestamp: '2026-01-01T12:00:30Z' }
      ]
    }),
    job('qa', 'running', { phase: 'specialist-review' }),
    job('docs', 'returned', { finishedAt: observedAt }),
    job('impact', 'published', { phase: 'publishing', publication: { kind: 'comment', id: 1, at: observedAt }, finishedAt: observedAt }),
    job('docs', 'returned', { target: { repository, number: 43 }, correlationId: 'fixture-other-target', finishedAt: observedAt })
  ],
  settings: null,
  usage: [{ role: 'reviewer', calls: 3, inputTokens: 13400, outputTokens: 2300, missingInput: 0, missingOutput: 1 }],
  observedAt
};

const pull = (number, title, evidence, draft = false) => ({
  repository, number, title, author: 'external-contributor', updatedAt: observedAt, draft,
  ...(evidence && { evidence: { observedAt, reviewsComplete: true, reviews: [], ...evidence } })
});
const approval = id => ({ role: 'reviewer', state: 'APPROVED', currentHead: true, submittedAt: observedAt, id });

export const contributors = {
  observedAt,
  partial: false,
  pulls: [
    pull(43, 'Improve component accessibility for long localized labels on narrow screens', {
      reviews: [approval(91)], workflow: { state: 'action-required', id: 71 }
    }),
    pull(45, 'Workflow rerun in progress', {
      reviews: [approval(92)], workflow: { state: 'running', id: 72, attempt: 2, name: 'CI' }
    }),
    pull(46, 'Failed browser tests', {
      reviewStatus: { state: 'failed', id: 93, updatedAt: observedAt, reason: 'checks-failed' },
      workflow: {
        state: 'failed', id: 73, attempt: 2, name: 'CI',
        failures: [{ job: 'extension', step: 'Chromium extension E2E', conclusion: 'failure', jobId: 74 }]
      }
    }),
    pull(44, 'Handle missing workflow evidence', undefined, true)
  ]
};

const adoptionObservedAt = new Date().toISOString();
export const adoption = {
  metrics: [
    {
      id: '@oddmash/ui', kind: 'npm', source: 'https://www.npmjs.com/package/@oddmash/ui', count: 133, observedAt: adoptionObservedAt,
      history: [
        { day: '2025-10-15', downloads: 4 },
        { day: '2025-11-15', downloads: 5 },
        ...Array.from({ length: 30 }, (_, index) => ({
          day: new Date(Date.UTC(2025, 11, index + 2)).toISOString().slice(0, 10),
          downloads: index === 24 ? 0 : index % 7 === 0 ? 50 : index
        })).filter((_, index) => index !== 26)
      ]
    },
    { id: '@oddmash/juliya', kind: 'npm', source: 'https://www.npmjs.com/package/@oddmash/juliya', count: null, history: null, observedAt: adoptionObservedAt },
    { id: 'oddmash.boundra-vscode', kind: 'marketplace', source: 'https://marketplace.visualstudio.com/items?itemName=oddmash.boundra-vscode', count: 12, history: null, observedAt: adoptionObservedAt }
  ]
};
