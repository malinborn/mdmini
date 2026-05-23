import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { syntaxTree } from '@codemirror/language';
import { Strikethrough, Table } from '@lezer/markdown';

function makeState(doc: string): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        extensions: [Strikethrough, Table],
      }),
    ],
  });
}

/**
 * Mirror of plugin.ts iteration logic: returns names of every node visited
 * by the live-preview iterator. Used to detect whether inline children of
 * a heading are reachable (i.e. whether the iterator descends into them).
 */
function visitedNodeNames(state: EditorState): string[] {
  const visited: string[] = [];
  syntaxTree(state).iterate({
    enter(node) {
      visited.push(node.name);
      switch (node.name) {
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6':
          // Mirror plugin.ts: descend so inline children get decorated.
          break;
        case 'Emphasis':
        case 'StrongEmphasis':
        case 'Strikethrough':
        case 'InlineCode':
        case 'Link':
        case 'FencedCode':
        case 'Table':
        case 'HorizontalRule':
        case 'Blockquote':
          return false;
        case 'ListItem':
          break;
      }
    },
  });
  return visited;
}

describe('heading inline children', () => {
  it('parser produces InlineCode as child of ATXHeading', () => {
    const state = makeState('## Run timer from `Task` when sync\n');
    const tree = syntaxTree(state);

    let foundInlineCodeInHeading = false;
    tree.iterate({
      enter(node) {
        if (
          node.name === 'ATXHeading1' ||
          node.name === 'ATXHeading2' ||
          node.name === 'ATXHeading3'
        ) {
          const cursor = node.node.cursor();
          if (cursor.firstChild()) {
            do {
              if (cursor.name === 'InlineCode') {
                foundInlineCodeInHeading = true;
              }
            } while (cursor.nextSibling());
          }
        }
      },
    });

    expect(foundInlineCodeInHeading).toBe(true);
  });

  it('iterator descends into heading children so InlineCode is reachable', () => {
    const state = makeState('## Run timer from `Task` when sync\n');
    const visited = visitedNodeNames(state);
    expect(visited).toContain('ATXHeading2');
    // The bug: if heading case returns false, InlineCode is never visited
    // and therefore never decorated. After fix, InlineCode must appear.
    expect(visited).toContain('InlineCode');
  });

  it('iterator descends into all heading levels', () => {
    const md = [
      '# H1 with `code1`',
      '## H2 with `code2`',
      '### H3 with `code3`',
      '#### H4 with `code4`',
      '##### H5 with `code5`',
      '###### H6 with `code6`',
      '',
    ].join('\n');
    const state = makeState(md);
    const visited = visitedNodeNames(state);
    const inlineCodeCount = visited.filter((n) => n === 'InlineCode').length;
    expect(inlineCodeCount).toBe(6);
  });

  it('iterator descends so Emphasis/StrongEmphasis inside headings are reached', () => {
    const state = makeState('## Heading with *italic* and **bold**\n');
    const visited = visitedNodeNames(state);
    expect(visited).toContain('Emphasis');
    expect(visited).toContain('StrongEmphasis');
  });
});
