import { listen } from '@tauri-apps/api/event';

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
 * One `mdmini ai show`/`edit` request, routed by Rust to the window that owns
 * `path`. Mirrors the camelCase `AiCommandPayload` serialized by
 * `src-tauri/src/ai_socket.rs` — field names and optionality must match.
 */
export interface AiCommandPayload {
  id: number;
  cmd: 'show' | 'edit';
  path: string;
  line: number | null;
  find: string | null;
  content: string | null;
  show: boolean;
}

/** Emitted to the window that owns the file targeted by an AI command. */
export function onAiCommand(handler: (payload: AiCommandPayload) => void): Promise<() => void> {
  return listen<AiCommandPayload>('ai-command', (event) => {
    handler(event.payload);
  });
}
