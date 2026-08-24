import { describe, expect, it } from 'vitest';
import { anchorPosition, buildHandoffPrompt, parseComments } from './comment-format';

const SAMPLE = `<!-- mdmini:comments v=1 doc=spec.md -->

<!-- mdmini:c id=c-7f3a2c status=open line=3 -->
> We ship via Caddy

**Макс** · 2026-08-24 14:02
Почему не nginx?

**agent** · 2026-08-24 14:05
Он был сломан.
`;

describe('parseComments', () => {
  it('reads threads, status, quote and replies', () => {
    const threads = parseComments(SAMPLE);
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe('c-7f3a2c');
    expect(threads[0].status).toBe('open');
    expect(threads[0].line).toBe(3);
    expect(threads[0].quote).toBe('We ship via Caddy');
    expect(threads[0].replies).toHaveLength(2);
    expect(threads[0].replies[1].author).toBe('agent');
    expect(threads[0].replies[1].text).toBe('Он был сломан.');
  });

  it('returns an empty list for an empty file', () => {
    expect(parseComments('')).toEqual([]);
  });

  it('skips a thread whose marker has no id', () => {
    expect(parseComments('<!-- mdmini:c status=open line=1 -->\n> q\n')).toEqual([]);
  });

  it('parses a reply header with a Cyrillic author name', () => {
    const text = `<!-- mdmini:c id=c-1 status=open line=1 -->
> anchor

**Максим Ковалевский** · 2026-08-24 14:02
Текст реплики.
`;
    const threads = parseComments(text);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].author).toBe('Максим Ковалевский');
    expect(threads[0].replies[0].at).toBe('2026-08-24 14:02');
    expect(threads[0].replies[0].text).toBe('Текст реплики.');
  });

  it('does not mistake a "> " line inside reply text for the anchor quote', () => {
    const text = `<!-- mdmini:c id=c-1 status=open line=1 -->
> anchor quote

**Макс** · 2026-08-24 14:02
See this:
> quoted from elsewhere
end of reply.
`;
    const threads = parseComments(text);
    expect(threads).toHaveLength(1);
    expect(threads[0].quote).toBe('anchor quote');
    expect(threads[0].replies).toHaveLength(1);
    expect(threads[0].replies[0].text).toBe('See this:\n> quoted from elsewhere\nend of reply.');
  });
});

describe('anchorPosition', () => {
  const doc = 'first\nWe ship via Caddy\nthird\n';

  it('finds the quote and returns its offset', () => {
    expect(anchorPosition(doc, 'We ship via Caddy', 2)).toEqual({ pos: 6, orphaned: false });
  });

  it('falls back to the stored line when the quote is gone', () => {
    const result = anchorPosition(doc, 'nothing like this', 3);
    expect(result.orphaned).toBe(true);
    expect(result.pos).toBe(24);
  });

  it('clamps a stored line beyond the end of the document', () => {
    const result = anchorPosition(doc, 'absent', 999);
    expect(result.orphaned).toBe(true);
    expect(result.pos).toBeLessThanOrEqual(doc.length);
  });
});

describe('buildHandoffPrompt', () => {
  it('names the comment file, the document and the thread id', () => {
    const prompt = buildHandoffPrompt('/repo/spec.md', 'c-7f3a2c');
    expect(prompt).toContain('/repo/.mdmini_comments_spec.md');
    expect(prompt).toContain('/repo/spec.md');
    expect(prompt).toContain('c-7f3a2c');
    expect(prompt).toContain('mdmini answer');
  });
});
