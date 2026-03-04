import { describe, expect, it } from 'vitest';
import { parseNicOrdinal, sortNicTabItems } from '../../lib/nicTabs';

describe('nicTabs helpers', () => {
  it('parses NIC ordinals from NIC labels', () => {
    expect(parseNicOrdinal('NIC1')).toBe(1);
    expect(parseNicOrdinal('nic 10')).toBe(10);
    expect(parseNicOrdinal(' NIC21 ')).toBe(21);
    expect(parseNicOrdinal('NIC0')).toBeNull();
    expect(parseNicOrdinal('Port1')).toBeNull();
  });

  it('sorts NIC labels numerically before non-NIC names', () => {
    const input = [
      { index: 0, nic: { name: 'NIC2' } },
      { index: 1, nic: { name: 'NIC10' } },
      { index: 2, nic: { name: 'NIC1' } },
      { index: 3, nic: { name: 'Mgmt' } },
      { index: 4, nic: { name: 'NIC11' } },
      { index: 5, nic: { name: 'Backup' } },
    ];

    const sorted = sortNicTabItems(input);
    expect(sorted.map((item) => String(item.nic?.name))).toEqual([
      'NIC1',
      'NIC2',
      'NIC10',
      'NIC11',
      'Backup',
      'Mgmt',
    ]);
  });

  it('keeps stable ordering for same NIC ordinal by index', () => {
    const input = [
      { index: 8, nic: { name: 'NIC3' } },
      { index: 2, nic: { name: 'NIC3' } },
      { index: 5, nic: { name: 'NIC3' } },
    ];

    const sorted = sortNicTabItems(input);
    expect(sorted.map((item) => item.index)).toEqual([2, 5, 8]);
  });
});
