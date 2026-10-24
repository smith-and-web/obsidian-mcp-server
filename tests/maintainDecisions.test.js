import { describe, it, expect } from 'vitest';
import { parseDecisions } from '../src/maintain/decisions.js';
describe('report ticks', () => {
  it('accepts checked lines, merges duplicates and ignores unchecked ones', () => {
    expect(
      parseDecisions(['- [x] accept f3\n* [X] reject f4\n- [ ] accept f5', '- [x] accept f3'])
    ).toEqual({
      decisions: [
        { id: 3, decision: 'accepted' },
        { id: 4, decision: 'rejected' },
      ],
      conflicts: [],
    });
  });
  it('combines conflict ticks across report notes', () =>
    expect(parseDecisions(['- [x] accept f6', '- [x] reject f6'])).toEqual({
      decisions: [],
      conflicts: [6],
    }));
  it('requires the exact line and f prefix', () =>
    expect(parseDecisions(['- [x] accept f3 trailing\n- [x] reject 4\n- [q] accept f5'])).toEqual({
      decisions: [],
      conflicts: [],
    }));
});
