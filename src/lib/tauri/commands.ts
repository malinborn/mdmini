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

const FILE_FILTERS = [
  { name: 'All Supported', extensions: ['md', 'markdown', 'txt', 'csv', 'json', 'yml', 'yaml', 'toml', 'py', 'rs', 'ts', 'js', 'sh', 'env'] },
  { name: 'Markdown', extensions: ['md', 'markdown', 'txt'] },
  { name: 'Data', extensions: ['csv', 'json', 'yml', 'yaml', 'toml'] },
  { name: 'Code', extensions: ['py', 'rs', 'ts', 'js', 'sh'] },
  { name: 'All Files', extensions: ['*'] },
];

export async function showOpenDialog(): Promise<string | null> {
  const result = await open({
    multiple: false,
    filters: FILE_FILTERS,
  });
  return result as string | null;
}

export async function showSaveDialog(defaultName?: string): Promise<string | null> {
  const result = await save({
    defaultPath: defaultName,
    filters: FILE_FILTERS,
  });
  return result as string | null;
}
