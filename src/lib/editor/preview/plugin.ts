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
          break;
        case 'Emphasis':
          decorateEmphasis(view, node.node, builder);
          break;
        case 'StrongEmphasis':
          decorateStrongEmphasis(view, node.node, builder);
          break;
        case 'Strikethrough':
          decorateStrikethrough(view, node.node, builder);
          break;
        case 'InlineCode':
          decorateInlineCode(view, node.node, builder);
          break;
        case 'Link':
          decorateLink(view, node.node, builder);
          break;
        case 'ListItem':
          decorateListItem(view, node.node, builder);
          break;
        case 'Blockquote':
          decorateBlockquote(view, node.node, builder);
          break;
      }
    },
  });

  return builder.finish();
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);
