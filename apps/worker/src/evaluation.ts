export type ReviewLabel = { path: string; line: number; side: 'LEFT' | 'RIGHT' };

export function evaluateAnchors(expected: ReviewLabel[], actual: ReviewLabel[]) {
  const key = (label: ReviewLabel) => JSON.stringify([label.path, label.line, label.side]);
  const reference = new Set(expected.map(key));
  const observed = new Set(actual.map(key));
  const truePositive = [...observed].filter(label => reference.has(label)).length;
  const falsePositive = observed.size - truePositive;
  const falseNegative = reference.size - truePositive;
  return { truePositive, falsePositive, falseNegative, precision: observed.size ? truePositive / observed.size : null, recall: reference.size ? truePositive / reference.size : null };
}
