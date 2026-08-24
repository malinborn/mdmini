/**
 * Pure helpers for the comment layer. The file format is a contract written to
 * by Rust, by agents, and by people editing it by hand, so the parser here is
 * forgiving: a thread it cannot make sense of is skipped and the rest are
 * still returned.
 *
 * Nothing from Tauri or CodeMirror — this module is tested in isolation.
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
  /** Line number as of the last write — a hint, not the truth. */
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

/** Parse the contents of a comment file. */
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
 * Where to draw a thread. Attachment is by searching for the quote; the stored
 * line number is only a fallback, because the text may have moved. If the quote
 * is gone the thread does not disappear — it is marked detached, because
 * drifting away silently is the one outcome it must never have.
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

/** Comment-file path for a document — the same rule as in Rust. */
export function sidecarPath(docPath: string): string {
  const slash = docPath.lastIndexOf('/');
  const dir = slash < 0 ? '' : docPath.slice(0, slash + 1);
  const name = slash < 0 ? docPath : docPath.slice(slash + 1);
  return `${dir}.mdmini_comments_${name}`;
}

/**
 * Short label for the fragment a thread is about, for the card header.
 *
 * Up to 30 characters is shown whole — eliding a short quote costs more than
 * it saves. Longer ones keep their first and last 15 characters, because both
 * ends carry information: the start says where the fragment begins, the end
 * disambiguates it from a neighbour that starts the same way.
 *
 * Newlines collapse to spaces: a header is one line, and a multi-line quote
 * would otherwise break the card layout.
 */
export function quotePreview(quote: string): string {
  const flat = quote.replace(/\s+/g, ' ').trim();
  if (flat.length <= 30) return flat;
  return `${flat.slice(0, 15)}…${flat.slice(-15)}`;
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
    `Watch for my comments under ${dir} and answer them.`,
    ``,
    `If you can react to an event stream (Claude Code: the Monitor tool):`,
    `Monitor({command: "mdmini watch ${dir}", description: "new mdmini comments", persistent: true})`,
    `persistent: true is not optional — without it the monitor dies after five`,
    `minutes and its silence is indistinguishable from "no comments".`,
    ``,
    `If you cannot, check \`mdmini question ${dir}\` at natural points: before`,
    `asking me something in chat, and before reporting that you are done.`,
    ``,
    `To answer: \`mdmini answer <file> --id <id>\` with the text on stdin. If a`,
    `comment asks for a change rather than an answer, make it with`,
    `\`mdmini edit\`, then close the thread with an answer.`,
  ].join('\n');
}

/**
 * Text behind the "send to agent" button: pasted into a chat with any agent,
 * including ones that have neither MCP nor a way of being woken.
 */
export function buildHandoffPrompt(docPath: string, id: string): string {
  return [
    `There is an open comment ${id} on ${docPath}, in ${sidecarPath(docPath)}.`,
    `Read the thread and answer it: append a reply under it and set status to answered.`,
    `If it asks for a change to the document itself, make the change, then answer in the thread.`,
    `With md-mini over MCP: the question and answer tools. From a shell: mdmini answer ${docPath} --id ${id} (text on stdin).`,
  ].join('\n');
}
