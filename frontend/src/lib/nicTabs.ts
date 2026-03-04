export type NicTabItem = {
  index: number;
  nic: {
    name?: unknown;
  } | null | undefined;
};

export function parseNicOrdinal(name: unknown): number | null {
  const raw = String(name ?? '').trim();
  const match = /^nic\s*(\d+)$/i.exec(raw);
  if (!match) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function sortNicTabItems<T extends NicTabItem>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aName = String(a.nic?.name ?? '').trim();
    const bName = String(b.nic?.name ?? '').trim();
    const aOrdinal = parseNicOrdinal(aName);
    const bOrdinal = parseNicOrdinal(bName);

    if (aOrdinal != null && bOrdinal != null) {
      if (aOrdinal !== bOrdinal) return aOrdinal - bOrdinal;
      return a.index - b.index;
    }

    if (aOrdinal != null) return -1;
    if (bOrdinal != null) return 1;

    const byName = aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
    if (byName !== 0) return byName;

    return a.index - b.index;
  });
}
