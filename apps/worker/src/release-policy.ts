type Api = <T>(path: string) => Promise<T>;
type Release = { tag_name: string; draft: boolean; prerelease: boolean; published_at: string | null };
type Commit = { sha: string };
type Comparison = { status: string; behind_by: number; merge_base_commit?: { sha: string } };
type Selection = { repository: string; actorId: string; event: string; ref: string; eventSha: string; tag: string; expectedCommit?: string };

const stableTag = /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/;
const commitSha = /^[a-f0-9]{40}$/;

export async function validateRelease(selection: Selection, api: Api): Promise<{ tag: string; commit: string }> {
  const { repository, actorId, event, ref, eventSha, tag, expectedCommit } = selection;
  if (repository !== 'Oddmash/oddmash-agents' || actorId !== '135234546') throw new Error('Unauthorized release repository or actor');
  if (tag.length > 64 || !stableTag.test(tag)) throw new Error('Only stable vMAJOR.MINOR.PATCH release tags are supported');
  if (event === 'release' ? ref !== `refs/tags/${tag}` || !commitSha.test(eventSha) : event !== 'workflow_dispatch' || ref !== 'refs/heads/main') throw new Error('Release event or dispatch reference is ineligible');
  const root = '/repos/' + repository;
  const release = await api<Release>(root + '/releases/latest');
  if (!release || release.tag_name !== tag || release.draft !== false || release.prerelease !== false || !release.published_at) throw new Error('Only the latest published stable release can be deployed');
  const resolved = await api<Commit>(root + '/commits/' + tag);
  const commit = resolved?.sha;
  if (!commitSha.test(commit ?? '') || (event === 'release' && commit !== eventSha) || (expectedCommit && commit !== expectedCommit)) throw new Error('Release tag no longer matches the expected commit');
  const comparison = await api<Comparison>(root + '/compare/' + commit + '...main');
  if (!['ahead', 'identical'].includes(comparison.status) || comparison.behind_by !== 0 || comparison.merge_base_commit?.sha !== commit) throw new Error('Release commit is not part of main history');
  return { tag, commit };
}
