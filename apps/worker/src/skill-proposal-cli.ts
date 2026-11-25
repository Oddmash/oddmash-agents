import { execFileSync } from 'node:child_process';
import { proposeSkillImprovement } from './skill-proposals.ts';

async function request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: object): Promise<T> {
  try {
    const args = ['api', '--method', method, path];
    if (body) args.push('--input', '-');
    return JSON.parse(execFileSync('gh', args, { input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', timeout: 15_000, maxBuffer: 4_000_000, stdio: ['pipe', 'pipe', 'pipe'] })) as T;
  } catch {
    throw new Error('GitHub request unavailable; check the current maintainer session and catalog access');
  }
}

try {
  console.log(JSON.stringify(await proposeSkillImprovement(request, process.argv.slice(2)), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Skill proposal failed');
  process.exitCode = 1;
}
