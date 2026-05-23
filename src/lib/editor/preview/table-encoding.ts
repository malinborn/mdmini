export function encodeForCommit(textareaValue: string): string {
  return textareaValue
    .replace(/\r\n?/g, '\n')   // normalize CRLF and lone CR to LF
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
