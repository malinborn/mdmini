/** Shared block insertion templates used by hover menu and slash commands. */

export interface BlockTemplate {
  /** Short identifier (used as slash command suffix and hover menu detail). */
  id: string;
  /** Human-readable label for menus. */
  label: string;
  /** Markdown text to insert. */
  insert: string;
  /** Cursor offset from end of inserted text (negative = move back). */
  cursorOffset?: number;
}

export const blockTemplates: BlockTemplate[] = [
  { id: 'h1', label: 'Heading 1', insert: '# ' },
  { id: 'h2', label: 'Heading 2', insert: '## ' },
  { id: 'h3', label: 'Heading 3', insert: '### ' },
  { id: 'h4', label: 'Heading 4', insert: '#### ' },
  { id: 'h5', label: 'Heading 5', insert: '##### ' },
  { id: 'h6', label: 'Heading 6', insert: '###### ' },
  { id: 'ul', label: 'Bullet list', insert: '- ' },
  { id: 'ol', label: 'Numbered list', insert: '1. ' },
  { id: 'task', label: 'Checkbox', insert: '- [ ] ' },
  { id: 'code', label: 'Code block', insert: '```\n\n```', cursorOffset: -4 },
  {
    id: 'table',
    label: 'Table',
    insert: '| Column 1 | Column 2 |\n|----------|----------|\n| -        | -        |\n',
  },
  { id: 'quote', label: 'Blockquote', insert: '> ' },
  { id: 'hr', label: 'Horizontal rule', insert: '---\n' },
];
