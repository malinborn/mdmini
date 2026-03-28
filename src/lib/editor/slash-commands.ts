import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

interface SlashCommand {
  label: string;
  detail: string;
  insert: string;
  cursorOffset?: number;
}

const commands: SlashCommand[] = [
  { label: '/heading1', detail: 'Heading 1', insert: '# ' },
  { label: '/heading2', detail: 'Heading 2', insert: '## ' },
  { label: '/heading3', detail: 'Heading 3', insert: '### ' },
  { label: '/heading4', detail: 'Heading 4', insert: '#### ' },
  { label: '/heading5', detail: 'Heading 5', insert: '##### ' },
  { label: '/heading6', detail: 'Heading 6', insert: '###### ' },
  { label: '/bullet', detail: 'Bullet list', insert: '- ' },
  { label: '/numbered', detail: 'Numbered list', insert: '1. ' },
  { label: '/checkbox', detail: 'Checkbox', insert: '- [ ] ' },
  { label: '/code', detail: 'Code block', insert: '```\n\n```', cursorOffset: -4 },
  {
    label: '/table',
    detail: 'Table',
    insert: '| Column 1 | Column 2 |\n|----------|----------|\n| -        | -        |\n',
  },
  { label: '/quote', detail: 'Blockquote', insert: '> ' },
  { label: '/hr', detail: 'Horizontal rule', insert: '---\n' },
];

function slashCommandSource(context: CompletionContext): CompletionResult | null {
  const before = context.matchBefore(/(?:^|\n)\s*\/\w*/);
  if (!before) return null;

  const slashIndex = before.text.lastIndexOf('/');
  const from = before.from + slashIndex;

  return {
    from,
    options: commands.map((cmd): Completion => ({
      label: cmd.label,
      detail: cmd.detail,
      apply: (view: EditorView, _completion: Completion, applyFrom: number, applyTo: number) => {
        view.dispatch({
          changes: { from: applyFrom, to: applyTo, insert: cmd.insert },
          selection: cmd.cursorOffset
            ? { anchor: applyFrom + cmd.insert.length + cmd.cursorOffset }
            : { anchor: applyFrom + cmd.insert.length },
        });
      },
    })),
  };
}

export function slashCommands(): Extension {
  return EditorState.languageData.of(() => [{ autocomplete: slashCommandSource }]);
}
