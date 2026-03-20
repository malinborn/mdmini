import { listen } from '@tauri-apps/api/event';

export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save_as'
  | 'close'
  | 'find'
  | 'toggle_mode'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'theme_light'
  | 'theme_dark'
  | 'theme_system';

export function onMenuEvent(handler: (action: MenuAction) => void): Promise<() => void> {
  return listen<string>('menu-event', (event) => {
    handler(event.payload as MenuAction);
  });
}
