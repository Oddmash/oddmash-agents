import { createHash } from 'node:crypto';

export function githubContentFixture(path: string, value: string) {
  const size = Buffer.byteLength(value);
  const sha = createHash('sha1').update(`blob ${size}\0`).update(value).digest('hex');
  return { type: 'file', encoding: 'base64', path, size, sha, content: Buffer.from(value).toString('base64') };
}
