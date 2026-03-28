import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { blockTemplates } from './block-templates';

function slashCommandSource(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|\n)\s*\/\w*/);
  if (!before) return null;

  const slashIndex = before.text.lastIndexOf('/');
  const from = before.from + slashIndex;

  return {
    from,
    options: blockTemplates.map((tpl): Completion => ({
      label: `/${tpl.id}`,
      detail: tpl.label,
      apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert: tpl.insert },
          selection: tpl.cursorOffset
            ? { anchor: applyFrom + tpl.insert.length + tpl.cursorOffset }
            : { anchor: applyFrom + tpl.insert.length },
        });
      },
    })),
  };
}

export function slashCommands(): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: slashCommandSource }]);
}
