import { listen } from '@tauri-apps/api/event';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';

export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save_as'
  | 'close'
  | 'select_all'
  | 'find'
  | 'toggle_mode'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'toggle_line_glow'
  | 'theme_light'
  | 'theme_dark'
  | 'theme_system'
  | 'recent_files';

export function onMenuEvent(handler: (action: MenuAction) => void): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    handler(event.payload as MenuAction);
  });
}

export function onOpenFile(handler: (path: string) => void): Promise<() => void> {
  return listen<string>('open-file', (event) => {
    handler(event.payload);
  });
}

export function onFileChangedExternally(handler: (path: string) => void): Promise<() => void> {
  return listen<string>('file-changed-externally', (event) => {
    handler(event.payload);
  });
}

/** Emitted by Rust after windows from the previous session have been reopened. */
export function onSessionRestored(handler: (count: number) => void): Promise<() => void> {
  return listen<number>('session-restored', (event) => {
    handler(event.payload);
  });
}

/** A newer release was found. Emitted to every window by the polling one. */
export function onUpdateAvailable(
  handler: (info: { latest: string; current: string }) => void
): Promise<() => void> {
  return listen<{ latest: string; current: string }>('update-available', (event) => {
    handler(event.payload);
  });
}

/**
 * The update notice was dismissed. Broadcast so closing it in one window closes
 * it in all of them, rather than once per window.
 */
export function onUpdateDismissed(handler: () => void): Promise<() => void> {
  return listen('update-dismissed', () => {
    handler();
  });
}

/**
 * One `mdmini ai show`/`edit`/`ask` request, routed by Rust to the window
 * that owns `path`. Mirrors the camelCase `AiCommandPayload` serialized by
 * `src-tauri/src/ai_socket.rs` — field names and optionality must match.
 * `question`/`options`/`multi`/`freeText`/`timeoutSecs` are only meaningful
 * for `ask` (`options` empty, `multi`/`freeText` false, and `timeoutSecs` 0
 * for `show`/`edit`).
 */
export interface AiCommandPayload {
  id: number;
  cmd: 'show' | 'edit' | 'ask';
  path: string;
  line: number | null;
  find: string | null;
  content: string | null;
  show: boolean;
  question: string | null;
  options: string[];
  /** Multi-choice (checkbox chips + confirm) vs single-choice (click an option). */
  multi: boolean;
  /** Adds a free-text input below the option row, in either mode. */
  freeText: boolean;
  timeoutSecs: number;
}

/**
 * Emitted to the window that owns the file targeted by an AI command.
 *
 * Must listen via the current webview window, not the global `listen`: a
 * global listener's target is `Any`, which matches *targeted* emits too, so
 * every window would receive the command and the non-owners would race to
 * answer it with an error.
 */
export function onAiCommand(handler: (payload: AiCommandPayload) => void): Promise<() => void> {
  return getCurrentWebviewWindow().listen<AiCommandPayload>('ai-command', (event) => {
    handler(event.payload);
  });
}
