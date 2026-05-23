import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { computeOrderedListRenumberChanges } from './autocomplete.js';

function applyRenumber(initial: string, anchorLineNumber: number): string {
  const state = EditorState.create({ doc: initial });
  const changes = computeOrderedListRenumberChanges(state.doc, anchorLineNumber);
  return state.update({ changes }).newDoc.toString();
}

describe('computeOrderedListRenumberChanges', () => {
  it('keeps already-correct numbering untouched', () => {
    const doc = ['1. A', '2. B', '3. C'].join('\n');
    expect(applyRenumber(doc, 1)).toBe(doc);
  });

  it('resets a newly indented item to 1 and renumbers parent items below', () => {
    // user pressed Tab on the second item (was "2. B" at parent level → now "   2. B" at child level)
    const doc = ['1. A', '   2. B', '3. C', '4. D'].join('\n');
    expect(applyRenumber(doc, 2)).toBe(
      ['1. A', '   1. B', '2. C', '3. D'].join('\n')
    );
  });

  it('user scenario: numbered list with continued counter after indent', () => {
    // After Enter on "2. ..." autocomplete inserts "3. ", then Tab indents it.
    // Before renumber: "   3. " — should become "   1. ".
    const doc = ['1. A', '2. B', '   3. '].join('\n');
    expect(applyRenumber(doc, 3)).toBe(
      ['1. A', '2. B', '   1. '].join('\n')
    );
  });

  it('renumbers parent list when an item is outdented (Shift-Tab)', () => {
    // user pressed Shift-Tab on the second sub-item — it moved up to parent level
    const doc = ['1. A', '   1. AA', '2. AB', '3. C'].join('\n');
    expect(applyRenumber(doc, 3)).toBe(
      ['1. A', '   1. AA', '2. AB', '3. C'].join('\n')
    );
  });

  it('continues numbering at deeper level when previous sibling exists at that level', () => {
    const doc = ['1. A', '   1. AA', '   3. AB'].join('\n');
    expect(applyRenumber(doc, 3)).toBe(
      ['1. A', '   1. AA', '   2. AB'].join('\n')
    );
  });

  it('resets deeper counters when returning to a shallower level', () => {
    const doc = [
      '1. A',
      '   1. AA',
      '   2. AB',
      '2. B',
      '   5. BA',
      '   9. BB',
    ].join('\n');
    expect(applyRenumber(doc, 1)).toBe(
      [
        '1. A',
        '   1. AA',
        '   2. AB',
        '2. B',
        '   1. BA',
        '   2. BB',
      ].join('\n')
    );
  });

  it('does not cross a blank line', () => {
    const doc = ['1. A', '2. B', '', '5. X', '6. Y'].join('\n');
    // anchor on first block — only that block renumbers; second block untouched
    expect(applyRenumber(doc, 1)).toBe(doc);
  });

  it('handles mixed bullets and ordered items at the same level', () => {
    const doc = ['- A', '- B', '1. C', '5. D'].join('\n');
    expect(applyRenumber(doc, 3)).toBe(
      ['- A', '- B', '1. C', '2. D'].join('\n')
    );
  });

  it('handles a single ordered item without changes', () => {
    expect(applyRenumber('1. A', 1)).toBe('1. A');
  });

  it('produces no changes for non-list lines around the anchor', () => {
    const state = EditorState.create({ doc: 'just text\nno list here' });
    const changes = computeOrderedListRenumberChanges(state.doc, 1);
    expect(changes).toEqual([]);
  });
});
