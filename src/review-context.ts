import { posix } from 'node:path';
import type { ChangedFile } from './core.ts';

export function reviewFocus(repository: string): string[] {
  const common = ['Correctness, regression, error handling and test coverage'];
  const name = repository.toLowerCase();
  if (name.endsWith('/kowrap')) return [...common, 'Unicode, line breaking, SSR, browser compatibility and DOM performance'];
  if (name.endsWith('/oddmash-ui')) return [...common, 'Keyboard interaction, accessibility, responsive states, design tokens and SSR'];
  if (name.endsWith('/interaction-inspector')) return [...common, 'Event lifecycle, cleanup, focus handling and extension compatibility'];
  if (/\/(?:cash-out|overtime-prototype)$/.test(name)) return [...common, 'Game state transitions, input, lifecycle and multiplayer consistency'];
  return common;
}

export function relatedPaths(files: ChangedFile[]): string[] {
  const changed = new Set(files.map(file => file.filename));
  const paths = new Set<string>();
  for (const file of files) {
    if (!/\.[cm]?[jt]sx?$/.test(file.filename)) continue;
    for (const line of (file.patch ?? '').split('\n')) {
      if (!/^[ +\-]/.test(line)) continue;
      const match = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"\s]+)['"]/.exec(line);
      if (!match) continue;
      const path = posix.normalize(posix.join(posix.dirname(file.filename), match[1]));
      if (!/^(?:src|app|components|lib|site|apps)\/[\w./-]+$/.test(path) || /(?:^|\/)(?:\.|\.\.|[^/]*(?:auth|secret|credential|config|token|key|deploy|security)[^/]*)(?:\/|$)/i.test(path)) continue;
      const candidates = /\.[cm]?[jt]sx?$/.test(path) ? [path] : [path + '.ts', path + '.tsx', path + '/index.ts'];
      for (const candidate of candidates) {
        if (!changed.has(candidate)) paths.add(candidate);
        if (paths.size >= 12) return [...paths];
      }
    }
  }
  return [...paths];
}

export type Usage = { input_tokens?: number; output_tokens?: number; total_tokens?: number };
export function recordUsage(phase: string, model: string, usage?: Usage) {
  if (!usage) return;
  const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  console.log(JSON.stringify({ event: 'reviewer_usage', phase, model, inputTokens: count(usage.input_tokens), outputTokens: count(usage.output_tokens), totalTokens: count(usage.total_tokens) }));
}
