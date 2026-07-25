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
