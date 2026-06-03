import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { Strikethrough, Table } from '@lezer/markdown';
import { slugify, headingSlugsField, getHeadingPos } from './heading-slugs';

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [Strikethrough, Table],
      }),
      headingSlugsField,
    ],
  });
}

describe('slugify', () => {
  const cases: Array<[string, string]> = [
    ['Hello, World!', 'hello-world'],
    ['Установка приложения!', 'установка-приложения'],
    ['Шаг 1: установка', 'шаг-1-установка'],
    ['  leading and trailing  ', 'leading-and-trailing'],
    ['multiple   spaces', 'multiple-spaces'],
    ['kebab-already-here', 'kebab-already-here'],
    ['emoji 🎉 stripped', 'emoji-stripped'],
    ['a/b\\c.d:e', 'abcde'],
    ['', ''],
    ['!!!', ''],
  ];

  for (const [input, expected] of cases) {
    it(`"${input}" → "${expected}"`, () => {
      expect(slugify(input)).toBe(expected);
    });
  }
});

describe('headingSlugsField', () => {
  it('indexes ATX headings by slug → line start position', () => {
    const doc = '# Hello\n\nbody\n\n## Установка\n\nmore\n';
    const state = makeState(doc);
    expect(getHeadingPos(state, 'hello')).toBe(0);
    expect(getHeadingPos(state, 'установка')).toBe(doc.indexOf('## Установка'));
  });

  it('returns null for unknown slug', () => {
    const state = makeState('# A\n');
    expect(getHeadingPos(state, 'nope')).toBeNull();
  });

  it('disambiguates duplicate slugs with -2, -3 suffixes', () => {
    const doc = '## Шаг 1\n\nx\n\n## Шаг 1\n\ny\n\n## Шаг 1\n';
    const state = makeState(doc);
    const first = doc.indexOf('## Шаг 1');
    const second = doc.indexOf('## Шаг 1', first + 1);
    const third = doc.indexOf('## Шаг 1', second + 1);
    expect(getHeadingPos(state, 'шаг-1')).toBe(first);
    expect(getHeadingPos(state, 'шаг-1-2')).toBe(second);
    expect(getHeadingPos(state, 'шаг-1-3')).toBe(third);
  });

  it('ignores empty headings (no slug)', () => {
    const state = makeState('## \n\nbody\n');
    expect(getHeadingPos(state, '')).toBeNull();
  });

  it('rebuilds on document change', () => {
    const initial = makeState('# Old\n');
    expect(getHeadingPos(initial, 'old')).toBe(0);
    const tr = initial.update({ changes: { from: 0, to: initial.doc.length, insert: '# New\n' } });
    const updated = tr.state;
    expect(getHeadingPos(updated, 'new')).toBe(0);
    expect(getHeadingPos(updated, 'old')).toBeNull();
  });
});
