import { addedLineText, isBlockingFinding, type Finding, type ReviewContext } from './core.ts';
import { sameFindingText } from './specialist-findings.ts';

function repeatedEvidenceKey(line: string): string {
  const namedImport = /\bimport\s*\{([^{}]+)\}\s*from\s*['"]([^'"\r\n]+)['"]/.exec(line);
  if (namedImport) return 'import:' + namedImport[1].split(',').map(specifier => specifier.trim().replace(/\s+/g, ' ')).filter(Boolean).sort().join(',') + ':' + namedImport[2];
  const normalized = line.trim();
  return normalized.length >= 30 ? 'line:' + normalized : '';
}

export function consolidateAdvisoryFindings(context: ReviewContext, findings: Finding[]): Finding[] {
  const result: Finding[] = [];
  const keys = new Map<Finding, string>();
  for (const finding of findings) {
    const source = context.files.find(file => file.filename === finding.path);
    const text = source && addedLineText(source.patch ?? '', finding.line);
    const eligible = finding.side !== 'LEFT' && !finding.suggestion && !finding.blockingEvidence && !isBlockingFinding(context, finding);
    const key = eligible && text ? repeatedEvidenceKey(text) : '';
    const rationale = (value: Finding) => [value.rule, value.evidence, value.recommendation].join(' ');
    const prior = key && result.find(item => keys.get(item) === key && item.severity === finding.severity &&
      item.confidence === finding.confidence && item.path !== finding.path &&
      sameFindingText(rationale(item), rationale(finding)));
    if (prior) {
      prior.relatedLocations = [...(prior.relatedLocations ?? []), { path: finding.path, line: finding.line }];
      continue;
    }
    const copy = { ...finding };
    result.push(copy);
    if (key) keys.set(copy, key);
  }
  return result;
}
