type TargetChoice = { key: string; target?: unknown };

export function visibleTargetSelection(groups: readonly TargetChoice[], selected: string | null | undefined): string | null | undefined {
  if (selected === null) return null;
  const identified = groups.filter(group => group.target !== undefined);
  return identified.some(group => group.key === selected) ? selected : identified[0]?.key;
}

export const toggleTargetSelection = (selected: string | null | undefined, key: string): string | null => selected === key ? null : key;
