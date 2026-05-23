import { describe, it, expect } from 'vitest';
import { encodeForCommit, decodeForEdit } from './table-encoding';

describe('encodeForCommit', () => {
  it('NoSpecialChars_ReturnsUnchanged', () => {
    expect(encodeForCommit('hello world')).toBe('hello world');
  });

  it('SingleNewline_ConvertsToBrTag', () => {
    expect(encodeForCommit('line1\nline2')).toBe('line1<br>line2');
  });

  it('MultipleNewlines_EachConvertsToBr', () => {
    expect(encodeForCommit('a\nb\nc')).toBe('a<br>b<br>c');
  });

  it('TrailingNewlines_AreTrimmed', () => {
    expect(encodeForCommit('a\nb\n\n')).toBe('a<br>b');
  });

  it('Pipe_EscapedWithBackslash', () => {
    expect(encodeForCommit('a|b')).toBe('a\\|b');
  });

  it('PipeAndNewline_BothEscaped', () => {
    expect(encodeForCommit('a|b\nc|d')).toBe('a\\|b<br>c\\|d');
  });

  it('EmptyString_ReturnsEmpty', () => {
    expect(encodeForCommit('')).toBe('');
  });

  it('OnlyNewlines_ReturnsEmpty', () => {
    expect(encodeForCommit('\n\n')).toBe('');
  });

  it('CRLF_NormalizedToLF', () => {
    expect(encodeForCommit('a\r\nb\r\nc')).toBe('a<br>b<br>c');
  });

  it('LoneCR_NormalizedToLF', () => {
    expect(encodeForCommit('a\rb')).toBe('a<br>b');
  });
});

describe('decodeForEdit', () => {
  it('NoSpecialChars_ReturnsUnchanged', () => {
    expect(decodeForEdit('hello world')).toBe('hello world');
  });

  it('BrTag_ConvertsToNewline', () => {
    expect(decodeForEdit('line1<br>line2')).toBe('line1\nline2');
  });

  it('SelfClosingBr_ConvertsToNewline', () => {
    expect(decodeForEdit('a<br/>b')).toBe('a\nb');
  });

  it('BrWithSpaces_ConvertsToNewline', () => {
    expect(decodeForEdit('a<br />b')).toBe('a\nb');
  });

  it('BrUppercase_ConvertsToNewline', () => {
    expect(decodeForEdit('a<BR>b')).toBe('a\nb');
  });

  it('EscapedPipe_Unescaped', () => {
    expect(decodeForEdit('a\\|b')).toBe('a|b');
  });

  it('RoundTrip_PreservesContent', () => {
    const input = 'hello|world\nsecond line';
    expect(decodeForEdit(encodeForCommit(input))).toBe(input);
  });

  // Documented tradeoff (see spec): literal "<br>" typed by user becomes a
  // newline on next edit. Acceptable because GFM cells can't contain real
  // newlines so <br> is the only sensible roundtrip path.
  it('LiteralBrTagFromUser_BecomesNewline', () => {
    expect(decodeForEdit('see <br> tag')).toBe('see \n tag');
  });
});
