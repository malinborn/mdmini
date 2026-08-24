/**
 * Чистые помощники для слоя комментариев. Формат файла — контракт, в который
 * пишут и Rust, и агенты, и человек руками, поэтому парсер здесь терпимый:
 * непонятный тред пропускается, остальные возвращаются.
 *
 * Ничего из Tauri и CodeMirror — модуль тестируется в изоляции.
 */

export type CommentStatus = 'open' | 'answered' | 'resolved';

export interface CommentReply {
  author: string;
  at: string;
  text: string;
}

export interface CommentThread {
  id: string;
  status: CommentStatus;
  /** Номер строки на момент записи — подсказка, а не истина. */
  line: number;
  quote: string;
  replies: CommentReply[];
}

const THREAD_MARKER = '<!-- mdmini:c ';

function parseMarker(line: string): Pick<CommentThread, 'id' | 'status' | 'line'> | null {
  const inner = line.trim().slice(THREAD_MARKER.length).replace(/-->$/, '').trim();
  let id = '';
  let status: CommentStatus | '' = '';
  let lineNumber = 1;
  for (const pair of inner.split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (key === 'id') id = value;
    else if (key === 'status' && (value === 'open' || value === 'answered' || value === 'resolved')) {
      status = value;
    } else if (key === 'line') {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) lineNumber = parsed;
    }
  }
  if (!id || !status) return null;
  return { id, status, line: lineNumber };
}

function parseReplyHeader(line: string): { author: string; at: string } | null {
  const match = /^\*\*([^*]+)\*\*\s+·\s+(.+)$/.exec(line);
  if (!match) return null;
  return { author: match[1], at: match[2].trim() };
}

/** Разобрать содержимое файла комментариев. */
export function parseComments(text: string): CommentThread[] {
  const threads: CommentThread[] = [];
  let current: CommentThread | null = null;
  let reply: CommentReply | null = null;
  let skipping = false;

  const flushReply = () => {
    if (current && reply) {
      reply.text = reply.text.replace(/\s+$/, '');
      current.replies.push(reply);
    }
    reply = null;
  };

  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith(THREAD_MARKER)) {
      flushReply();
      if (current) threads.push(current);
      const marker = parseMarker(line);
      skipping = marker === null;
      current = marker ? { ...marker, quote: '', replies: [] } : null;
      continue;
    }
    if (skipping || !current) continue;

    if (!reply && line.startsWith('> ')) {
      current.quote = current.quote ? `${current.quote}\n${line.slice(2).trimEnd()}` : line.slice(2).trimEnd();
      continue;
    }

    const header = parseReplyHeader(line);
    if (header) {
      flushReply();
      reply = { ...header, text: '' };
      continue;
    }

    if (reply) {
      if (!line.trim() && !reply.text) continue;
      reply.text = reply.text ? `${reply.text}\n${line}` : line;
    }
  }

  flushReply();
  if (current) threads.push(current);
  return threads;
}

/**
 * Где рисовать тред. Привязка идёт поиском цитаты; сохранённый номер строки —
 * только fallback, потому что текст мог сдвинуться. Не нашли цитату — тред не
 * исчезает, а помечается отвязанным: молча уехать он не должен.
 */
export function anchorPosition(
  doc: string,
  quote: string,
  line: number
): { pos: number; to: number; orphaned: boolean } {
  const firstQuoteLine = quote.split('\n')[0];
  if (firstQuoteLine) {
    const found = doc.indexOf(firstQuoteLine);
    // `to` bounds the quoted fragment so the document can mark it — a card
    // that only shows the quote leaves the reader hunting for which words it
    // is about. Only the first quote line is matched, so the range never
    // crosses a newline, which a mark decoration would render badly.
    if (found >= 0) return { pos: found, to: found + firstQuoteLine.length, orphaned: false };
  }
  const lines = doc.split('\n');
  const index = Math.max(0, Math.min(line - 1, lines.length - 1));
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += lines[i].length + 1;
  const clamped = Math.min(pos, doc.length);
  // Detached: there is no fragment to mark, so the range is empty and the
  // card carries the "anchor lost" label instead.
  return { pos: clamped, to: clamped, orphaned: true };
}

/** Путь файла комментариев для документа — то же правило, что в Rust. */
export function sidecarPath(docPath: string): string {
  const slash = docPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : docPath.slice(0, slash + 1);
  const name = slash < 0 ? docPath : docPath.slice(slash + 1);
  return `${dir}.mdmini_comments_${name}`;
}

/** Directory a document lives in, for scoping the watch command. */
export function documentDir(docPath: string): string {
  const slash = docPath.lastIndexOf('/');
  return slash <= 0 ? '/' : docPath.slice(0, slash);
}

/**
 * Ready-to-paste text that gets an agent watching this document's comments.
 *
 * Nothing in the app can arm a watch by itself — the agent has to run it, in
 * its own session, and there is no way for the editor to reach into that. So
 * the discoverable surface is a command the user hands over, and it has to
 * explain the one flag that silently breaks everything if omitted.
 */
export function buildWatchPrompt(docPath: string): string {
  const dir = documentDir(docPath);
  return [
    `Следи за моими комментариями в ${dir} и отвечай на них.`,
    ``,
    `Если умеешь реагировать на поток событий (Claude Code — инструмент Monitor):`,
    `Monitor({command: "mdmini watch ${dir}", description: "новые комменты в mdmini", persistent: true})`,
    `Без persistent: true монитор умрёт через пять минут, и его тишина будет`,
    `выглядеть как «комментариев нет».`,
    ``,
    `Если не умеешь — проверяй \`mdmini question ${dir}\` перед тем, как спросить`,
    `меня в чате, и перед тем, как отчитаться о завершении.`,
    ``,
    `Отвечать: \`mdmini answer <файл> --id <id>\`, текст на stdin. Если коммент`,
    `просит правку — примени её через \`mdmini edit\`, потом закрой тред ответом.`,
  ].join('\n');
}

/**
 * Текст для кнопки «отправить в агента»: вставляется в чат любому агенту,
 * включая тех, у кого нет ни MCP, ни механизма пробуждения.
 */
export function buildHandoffPrompt(docPath: string, id: string): string {
  return [
    `В файле ${sidecarPath(docPath)} есть открытый комментарий ${id} к ${docPath}.`,
    `Прочитай тред и ответь: допиши реплику под ним и поменяй status на answered.`,
    `Если нужна правка самого документа — примени её, затем ответь в тред.`,
    `С MCP md-mini: инструменты question и answer. Из CLI: mdmini answer ${docPath} --id ${id} (текст на stdin).`,
  ].join('\n');
}
