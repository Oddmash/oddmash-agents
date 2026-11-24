export const advisoryRoles = ['impact', 'triage', 'qa', 'release', 'docs', 'architect'] as const;
export type AdvisoryRole = typeof advisoryRoles[number];

export function isAdvisoryRole(value: unknown): value is AdvisoryRole {
  return typeof value === 'string' && advisoryRoles.includes(value as AdvisoryRole);
}

export const advisoryProfiles = {
  impact: { name: 'Impact', scope: 'pull', instructions: 'Evaluate user value, product fit, maintenance cost, trade-offs and missing evidence.' },
  triage: { name: 'Triage', scope: 'issue', instructions: 'Classify the issue, assess urgency and feasibility, compare the listed open issues for likely duplicates, and recommend a concrete next step. Do not claim duplication without evidence or change labels.' },
  qa: { name: 'QA', scope: 'pull', instructions: 'Assess the adequacy of existing test coverage, observed check results, and missing regression scenarios. Distinguish actual results from suggested tests; never execute contributor code or claim a test was run.' },
  release: { name: 'Release', scope: 'pull', instructions: 'Draft concise user-facing release notes, compatibility and migration considerations, and a suggested version impact. Do not publish, tag, deploy or claim release readiness.' },
  docs: { name: 'Docs', scope: 'pull', instructions: 'Assess whether changed behavior, examples, public API descriptions or setup guidance require updates. Identify missing documentation and suggest specific documentation topics without editing files.' },
  architect: { name: 'Architect', scope: 'pull', instructions: 'Assess modularity, coupling, maintainability, compatibility, complexity and trade-offs. Prefer the smallest adequate solution and avoid speculative redesign.' }
} as const;

export function advisoryCommand(body: string, slug: string): AdvisoryRole | undefined {
  if (!/^[a-z0-9-]+$/i.test(slug)) return;
  const normalized = body.trim().toLowerCase();
  return advisoryRoles.find(role => normalized === `@${slug.toLowerCase()} /${role}` || normalized === `@${slug.toLowerCase()}[bot] /${role}`);
}
