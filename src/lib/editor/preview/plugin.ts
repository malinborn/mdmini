import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  type EditorView,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { decorateHeading } from './headings';
import {
  decorateEmphasis,
  decorateStrongEmphasis,
  decorateStrikethrough,
  decorateInlineCode,
  decorateLink,
} from './inline';
import { decorateListItem, decorateBlockquote } from './lists';
import { decorateHorizontalRule, decorateFencedCode } from './blocks';
import { decorateTable } from './tables';
import { decorateMermaidBlock, mermaidRendered } from './mermaid';

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();

  syntaxTree(view.state).iterate({
    enter(node) {
      switch (node.name) {
        case 'ATXHeading1':
        case 'ATXHeading2':
        case 'ATXHeading3':
        case 'ATXHeading4':
        case 'ATXHeading5':
        case 'ATXHeading6':
          decorateHeading(view, node.node, builder);
          return false;
        case 'Emphasis':
          decorateEmphasis(view, node.node, builder);
          return false;
        case 'StrongEmphasis':
          decorateStrongEmphasis(view, node.node, builder);
          return false;
        case 'Strikethrough':
          decorateStrikethrough(view, node.node, builder);
          return false;
        case 'InlineCode':
          decorateInlineCode(view, node.node, builder);
          return false;
        case 'Link':
          decorateLink(view, node.node, builder);
          return false;
        case 'FencedCode': {
          const doc = view.state.doc;
          const fenceLine = doc.lineAt(node.from);
          const fenceText = doc.sliceString(fenceLine.from, fenceLine.to);
          const langMatch = fenceText.match(/^`{3,}(\w+)/);
          if (langMatch && langMatch[1].toLowerCase() === 'mermaid') {
            decorateMermaidBlock(view, node.node, builder);
          } else {
            decorateFencedCode(view, node.node, builder);
          }
          return false;
        }
        case 'Table':
          decorateTable(view, node.node, builder);
          return false;
        case 'HorizontalRule':
          decorateHorizontalRule(view, node.node, builder);
          return false;
        case 'ListItem':
          decorateListItem(view, node.node, builder);
          break;
        case 'Blockquote':
          decorateBlockquote(view, node.node, builder);
          return false;
      }
    },
  });

  return builder.finish();
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      try {
        this.decorations = buildDecorations(view);
      } catch (e) {
        console.warn('Live preview decoration error:', e);
        this.decorations = Decoration.none;
      }
    }

    update(update: ViewUpdate) {
      const treeChanged = syntaxTree(update.state) !== syntaxTree(update.startState);
      const mermaidUpdate = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(mermaidRendered))
      );
      if (update.docChanged || update.viewportChanged || update.selectionSet || treeChanged || mermaidUpdate) {
        try {
          this.decorations = buildDecorations(update.view);
        } catch (e) {
          console.warn('Live preview decoration error:', e);
          this.decorations = Decoration.none;
        }
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
