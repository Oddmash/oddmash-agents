import { runReview } from './reviewer.ts';

const [repository, number, ...flags] = process.argv.slice(2);
if (!repository || !number || flags.some(x => x !== '--post')) {
  console.error('Usage: pnpm run review Oddmash/<repository> <pr-number> [--post]');
  process.exitCode = 1;
} else {
  try {
    const result = await runReview({ repository, number: Number(number), githubToken: process.env.GITHUB_TOKEN ?? '', openaiKey: process.env.OPENAI_API_KEY ?? '', model: process.env.OPENAI_MODEL ?? '', post: flags.includes('--post') && process.env.ODDMASH_ALLOW_POST === 'true', allowedRepositories: (process.env.ODDMASH_ALLOWED_REPOSITORIES ?? '').split(',').map(x => x.trim()).filter(Boolean) });
    console.log(result.report);
    console.log(`\nPosted: ${result.posted}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Review failed');
    process.exitCode = 1;
  }
}
