type QuotaCheck = {
  status: string;
  conclusion: string | null;
  app?: { id: number };
  details_url?: string | null;
  output?: { title?: string | null; summary?: string | null };
};

const billingSignals = [
  /^(?:the job was not started because )?recent account payments have failed or your spending limit needs to be increased\.?$/i,
  /^the job was not started because (?:the )?(?:actions|github actions) (?:spending limit|budget) (?:has been reached|was exceeded)\.?$/i,
  /^github actions (?:runner minutes|artifact storage) quota (?:has been exceeded|has been reached)\.?$/i
];

export function actionsQuotaEvidence(checks: readonly QuotaCheck[]): QuotaCheck | undefined {
  return checks.find(check => {
    if (check.app?.id !== 15368 || check.status !== 'completed' || !['failure', 'cancelled', 'action_required'].includes(check.conclusion ?? '')) return false;
    return [check.output?.title, check.output?.summary].some(value => typeof value === 'string' && value.length <= 4096 && value.split(/\r?\n/).some(line => billingSignals.some(signal => signal.test(line.trim()))));
  });
}

export function actionsQuotaBlocked(checks: readonly QuotaCheck[]): boolean {
  return actionsQuotaEvidence(checks) !== undefined;
}

export function actionsWorkflowUrl(check: QuotaCheck, repository: string): string | undefined {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !check.details_url) return;
  try {
    const url = new URL(check.details_url);
    const parts = url.pathname.split('/');
    if (url.origin !== 'https://github.com' || url.username || url.password || parts.slice(1, 3).join('/').toLowerCase() !== repository.toLowerCase() || parts[3] !== 'actions' || parts[4] !== 'runs' || !/^\d+$/.test(parts[5] ?? '')) return;
    return `https://github.com/${repository}/actions/runs/${parts[5]}`;
  } catch { return; }
}
