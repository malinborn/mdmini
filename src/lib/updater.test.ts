import { describe, it, expect } from 'vitest';
import { isNewer } from './updater';

describe('isNewer', () => {
  it('HigherPatch_True', () => {
    expect(isNewer('v0.4.1', '0.4.0')).toBe(true);
  });

  it('HigherMinor_True', () => {
    expect(isNewer('v0.5.0', '0.4.9')).toBe(true);
  });

  it('HigherMajor_True', () => {
    expect(isNewer('v1.0.0', '0.9.9')).toBe(true);
  });

  it('SameVersion_False', () => {
    expect(isNewer('v0.4.0', '0.4.0')).toBe(false);
  });

  it('OlderVersion_False', () => {
    expect(isNewer('v0.3.9', '0.4.0')).toBe(false);
  });

  it('TagPrefixOptional', () => {
    expect(isNewer('0.4.1', '0.4.0')).toBe(true);
  });
});
