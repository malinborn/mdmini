import { describe, it, expect } from 'vitest';
import { HINT_REVIVE_MS, shouldShowHint, nextCheckDelay } from './ai-hint';

const NOW = 1_700_000_000_000;

describe('shouldShowHint', () => {
  it('is false when no highlight is visible', () => {
    expect(shouldShowHint({ seenBefore: false, visibleSince: null, now: NOW })).toBe(false);
    expect(shouldShowHint({ seenBefore: true, visibleSince: null, now: NOW })).toBe(false);
  });

  it('is true the first time the user has ever seen the highlight, regardless of duration', () => {
    expect(shouldShowHint({ seenBefore: false, visibleSince: NOW, now: NOW })).toBe(true);
  });

  it('is false once seen, before the highlight has been visible for 2 hours', () => {
    expect(
      shouldShowHint({ seenBefore: true, visibleSince: NOW, now: NOW + HINT_REVIVE_MS - 1 })
    ).toBe(false);
  });

  it('is true once seen, exactly at the 2 hour mark', () => {
    expect(
      shouldShowHint({ seenBefore: true, visibleSince: NOW, now: NOW + HINT_REVIVE_MS })
    ).toBe(true);
  });

  it('is true once seen, well past the 2 hour mark', () => {
    expect(
      shouldShowHint({ seenBefore: true, visibleSince: NOW, now: NOW + HINT_REVIVE_MS * 3 })
    ).toBe(true);
  });
});

describe('nextCheckDelay', () => {
  it('returns the remaining time to the 2 hour mark', () => {
    expect(nextCheckDelay({ visibleSince: NOW, now: NOW + 1000 })).toBe(HINT_REVIVE_MS - 1000);
  });

  it('returns the full window when just now became visible', () => {
    expect(nextCheckDelay({ visibleSince: NOW, now: NOW })).toBe(HINT_REVIVE_MS);
  });

  it('clamps to 0 once the deadline has already passed', () => {
    expect(nextCheckDelay({ visibleSince: NOW, now: NOW + HINT_REVIVE_MS + 5000 })).toBe(0);
  });

  it('clamps to 0 exactly at the deadline', () => {
    expect(nextCheckDelay({ visibleSince: NOW, now: NOW + HINT_REVIVE_MS })).toBe(0);
  });
});
