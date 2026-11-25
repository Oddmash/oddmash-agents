const categories = {
  'ui-feedback': { skill: 'oddmash-ux-design', scope: 'User-visible interaction feedback and recovery' },
  'visual-layout': { skill: 'oddmash-visual-clarity', scope: 'Layout stability and content clarity' },
  'docs-examples': { skill: 'oddmash-developer-documentation', scope: 'Examples and required API inputs' },
  'test-coverage': { skill: 'oddmash-quality-assurance', scope: 'Regression coverage and verification' },
  'compatibility': { skill: 'oddmash-quality-assurance', scope: 'Supported platform and framework compatibility' },
  'maintainability': { skill: 'oddmash-technical-architecture', scope: 'Ordinary application maintainability' }
} as const;

type Category = keyof typeof categories;
type Evidence = { repository: string; number: number; reference: string };
type Issue = { number: number; title: string; body: string | null; state: string; pull_request?: unknown };
type Comment = { body: string | null; author_association?: string };
type Request = <T>(path: string, method?: 'GET' | 'POST', body?: object) => Promise<T>;
const catalog = '/repos/Oddmash/oddmash-skills';
const categoryNames = Object.keys(categories);

export function parseProposalArgs(args: string[]) {
  const category = args[0];
  if (!categoryNames.includes(category)) throw new Error('Choose a supported quality category: ' + categoryNames.join(', '));
  const publish = args.includes('--publish');
  const confirmedGap = args.includes('--confirm-gap');
  const refs = args.slice(1).filter(arg => arg !== '--publish' && arg !== '--confirm-gap');
  if (refs.length < 2 || refs.length > 8) throw new Error('Supply two to eight independently verified public PR references');
  if (publish && !confirmedGap) throw new Error('Review the owning skill and confirm the shared guidance gap before publishing');
  const evidence = refs.map(ref => {
    const match = /^Oddmash\/([a-zA-Z0-9][a-zA-Z0-9-]{0,99})#([1-9][0-9]{0,8})$/i.exec(ref);
    if (!match) throw new Error('Invalid source PR reference; use Oddmash/repository#number');
    const repository = 'Oddmash/' + match[1].toLowerCase();
    const number = Number(match[2]);
    if (['Oddmash/oddmash-skills', 'Oddmash/oddmash-agents'].includes(repository)) throw new Error('Use product quality evidence only');
    return { repository, number, reference: `https://github.com/${repository}/pull/${number}` };
  });
  if (new Set(evidence.map(item => item.reference)).size !== evidence.length) throw new Error('Evidence must contain distinct PRs');
  return { category: category as Category, evidence, publish };
}

async function paginate<T>(request: Request, path: string): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await request<T[]>(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(batch) || batch.length > 100) throw new Error('Invalid GitHub list response');
    all.push(...batch);
    if (batch.length < 100) return all;
  }
  throw new Error('Catalog lookup incomplete; do not publish a duplicate proposal');
}

async function verifySource(request: Request, evidence: Evidence) {
  const repository = await request<{ id: number; full_name: string; private: boolean; archived: boolean }>(`/repos/${evidence.repository}`);
  if (repository.private !== false || repository.archived !== false || repository.full_name?.toLowerCase() !== evidence.repository.toLowerCase() || !Number.isSafeInteger(repository.id)) throw new Error('Source PR is not from an active public Oddmash product');
  const pull = await request<{ number: number; state: string; merged_at: string | null; base: { repo: { id: number } } }>(`/repos/${evidence.repository}/pulls/${evidence.number}`);
  if (pull.number !== evidence.number || pull.state !== 'closed' || !pull.merged_at || pull.base?.repo?.id !== repository.id) throw new Error('Source PR is not a verified merged product PR');
}

export async function proposeSkillImprovement(request: Request, args: string[]) {
  const { category, evidence, publish } = parseProposalArgs(args);
  for (const example of evidence) await verifySource(request, example);
  const { skill, scope } = categories[category];
  const title = `Skill proposal: ${skill} (${category})`;
  const marker = `<!-- oddmash-skill-proposal:${skill}:${category} -->`;
  const evidenceMarker = `<!-- oddmash-skill-evidence:${category} -->`;
  const issues = (await paginate<Issue>(request, `${catalog}/issues?state=all`)).filter(issue => !issue.pull_request && (issue.title === title || issue.body?.includes(marker)));
  if (issues.length > 1 || issues.some(issue => issue.title !== title || !issue.body?.includes(marker) || !Number.isSafeInteger(issue.number) || issue.number < 1)) throw new Error('Ambiguous proposal history; resolve duplicates manually');
  const existing = issues[0];
  const references = evidence.map(item => item.reference);
  const list = (values: string[]) => values.map(value => `- ${value}`).join('\n');
  const body = `${marker}\n\n## Area\n\n${scope}. Review \`skills/${skill}/SKILL.md\` for a reusable guidance gap.\n\n## Verified examples\n\n${list(references)}\n\n## Acceptance\n\n- [ ] Confirm the shared guidance gap rather than a product-only defect.\n- [ ] Update the owning skill through a reviewed PR and realistic verification.\n- [ ] Preserve independent consumer revision pins; no automatic adoption.\n`;
  if (!existing) {
    if (!publish) return { action: 'create-preview', title, body };
    const created = await request<{ number: number }>(`${catalog}/issues`, 'POST', { title, body });
    if (!Number.isSafeInteger(created.number) || created.number < 1) throw new Error('Unexpected issue creation response');
    return { action: 'created', number: created.number };
  }
  if (existing.state !== 'open') return { action: 'closed-existing', number: existing.number };
  const comments = await paginate<Comment>(request, `${catalog}/issues/${existing.number}/comments`);
  const prior = [existing.body, ...comments.filter(comment => ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(comment.author_association ?? '') && comment.body?.includes(evidenceMarker)).map(comment => comment.body)].join('\n');
  const seen = new Set(prior.match(/^\- https:\/\/github\.com\/Oddmash\/[a-z0-9-]+\/pull\/[1-9][0-9]*$/gm)?.map(line => line.slice(2)) ?? []);
  const novel = references.filter(reference => !seen.has(reference));
  if (novel.length === 0) return { action: 'duplicate', number: existing.number };
  const comment = `${evidenceMarker}\n\nAdditional verified examples for the same guidance gap:\n\n${list(novel)}`;
  if (!publish) return { action: 'append-preview', number: existing.number, body: comment };
  await request(`${catalog}/issues/${existing.number}/comments`, 'POST', { body: comment });
  return { action: 'appended', number: existing.number };
}
