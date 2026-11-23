type QuotaCheck = {
  status: string;
  conclusion: string | null;
  app?: { id: number };
  output?: { title?: string | null; summary?: string | null };
};

const billingSignals = [
  /^(?:the job was not started because )?recent account payments have failed or your spending limit needs to be increased\.?$/i,
  /^the job was not started because (?:the )?(?:actions|github actions) (?:spending limit|budget) (?:has been reached|was exceeded)\.?$/i,
  /^github actions (?:runner minutes|artifact storage) quota (?:has been exceeded|has been reached)\.?$/i
];

export function actionsQuotaBlocked(checks: readonly QuotaCheck[]): boolean {
  return checks.some(check => {
    if (check.app?.id !== 15368 || check.status !== 'completed' || !['failure', 'cancelled', 'action_required'].includes(check.conclusion ?? '')) return false;
    return [check.output?.title, check.output?.summary].some(value => typeof value === 'string' && value.length <= 4096 && value.split(/\r?\n/).some(line => billingSignals.some(signal => signal.test(line.trim()))));
  });
}
