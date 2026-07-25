import { describe, it, expect } from 'vitest';
import { clampCursor, clampTopLine } from './session-position';

describe('clampCursor', () => {
  it('InsideDocument_Unchanged', () => {
    expect(clampCursor(50, 100)).toBe(50);
  });

  it('PastEnd_ClampedToLength', () => {
    // the file shrank on disk while the app was closed
    expect(clampCursor(5000, 100)).toBe(100);
  });

  it('Negative_ClampedToZero', () => {
    expect(clampCursor(-10, 100)).toBe(0);
  });

  it('EmptyDocument_Zero', () => {
    expect(clampCursor(42, 0)).toBe(0);
  });
});

describe('clampTopLine', () => {
  it('InsideDocument_Unchanged', () => {
    expect(clampTopLine(12, 100)).toBe(12);
  });

  it('PastLastLine_ClampedToLastLine', () => {
    expect(clampTopLine(900, 100)).toBe(100);
  });

  it('ZeroOrNegative_ClampedToOne', () => {
    // CodeMirror doc.line() is 1-based and throws on 0
    expect(clampTopLine(0, 100)).toBe(1);
    expect(clampTopLine(-5, 100)).toBe(1);
  });

  it('SingleLineDocument_AlwaysOne', () => {
    expect(clampTopLine(7, 1)).toBe(1);
  });
});
