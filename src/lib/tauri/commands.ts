import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export async function readFile(path: string): Promise<string> {
  return invoke<string>('read_file', { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke('write_file', { path, content });
}

export async function fileExists(path: string): Promise<boolean> {
  return invoke<boolean>('file_exists', { path });
}

const MD_FILTERS = [{ name: 'Markdown', extensions: ['md', 'markdown', 'txt'] }];

export async function showOpenDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: MD_FILTERS,
  });
  return result as string | null;
}

export async function showSaveDialog(defaultName?: string): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: MD_FILTERS,
  });
  return result as string | null;
}
