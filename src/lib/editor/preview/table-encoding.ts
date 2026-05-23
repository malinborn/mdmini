export function encodeForCommit(textareaValue: string): string {
  return textareaValue
    .replace(/\|/g, '\\|')
    .replace(/\n+$/, '')
    .split('\n')
    .join('<br>');
}

export function decodeForEdit(cellText: string): string {
  return cellText
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/\\\|/g, '|');
}
