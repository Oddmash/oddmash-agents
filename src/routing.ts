export const publicRepositories = ['Oddmash/.github', 'Oddmash/interaction-inspector', 'Oddmash/oddmash-ui', 'Oddmash/Vertactics', 'Oddmash/juliya', 'Oddmash/boundra'];

export function reviewTarget(repository: string, number: string): { repository: string; number: number } | null {
  if (!repository && !number) return null;
  const parsed = Number(number);
  if (!publicRepositories.includes(repository) || !/^\d+$/.test(number) || !Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Invalid or non-opted-in review target');
  return { repository, number: parsed };
}
