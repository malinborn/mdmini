import { describe, it, expect } from 'vitest';
import { isNewer, releaseHighlight } from './updater';

describe('releaseHighlight', () => {
  it('returns null when there are no notes at all', () => {
    expect(releaseHighlight(null)).toBeNull();
    expect(releaseHighlight('')).toBeNull();
    expect(releaseHighlight('   \n\n  ')).toBeNull();
  });

  it('takes the first real line', () => {
    const body = '\n\n## What is new\n\nComment on any fragment and your agent answers.\n';
    expect(releaseHighlight(body)).toBe('Comment on any fragment and your agent answers.');
  });

  it('prefers prose over the section heading above it', () => {
    // "What is new" is navigation, not news.
    const body = '## What is new\n\nComments arrive in the document.\n';
    expect(releaseHighlight(body)).toBe('Comments arrive in the document.');
  });

  it('falls back to a heading when the notes are headings all the way down', () => {
    // Terse releases still deserve to say something, and the marker is stripped
    // because the toast renders plain text — a literal "### " reads as a bug.
    expect(releaseHighlight('### Comments arrive in the document')).toBe(
      'Comments arrive in the document'
    );
  });

  it('strips list bullets and emphasis', () => {
    expect(releaseHighlight('- **Comments** on any `fragment`')).toBe('Comments on any fragment');
  });

  it('skips badge and image rows', () => {
    const body = '![build](https://example.com/b.svg)\n\nReal news lives here.\n';
    expect(releaseHighlight(body)).toBe('Real news lives here.');
  });

  it('skips a line too short to be a sentence', () => {
    expect(releaseHighlight('v1.1\n\nSomething worth reading.')).toBe('Something worth reading.');
  });

  it('truncates a long line instead of overflowing the toast', () => {
    const highlight = releaseHighlight('z'.repeat(400));
    expect(highlight).toHaveLength(120);
    expect(highlight?.endsWith('…')).toBe(true);
  });
});

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
