import { languages } from '@codemirror/language-data';
import type { LanguageDescription } from '@codemirror/language';

// Extensionless config dotfiles → language name as it appears in @codemirror/language-data.
export const FILENAME_LANGUAGE: Record<string, string> = {
  '.zshrc': 'Shell',
  '.zshenv': 'Shell',
  '.zprofile': 'Shell',
  '.zlogin': 'Shell',
  '.zlogout': 'Shell',
  '.zsh_aliases': 'Shell',
  '.bashrc': 'Shell',
  '.bash_profile': 'Shell',
  '.bash_login': 'Shell',
  '.bash_logout': 'Shell',
  '.bash_aliases': 'Shell',
  '.profile': 'Shell',
  '.aliases': 'Shell',
  '.functions': 'Shell',
  '.exports': 'Shell',
};

/**
 * Resolve a CodeMirror LanguageDescription for a file: special-case basename first
 * (extensionless shell configs), then fall back to extension lookup. Returns null
 * if neither matches. `basename`/`ext` are lowercased defensively.
 */
export function findCodeLanguage(basename: string, ext: string): LanguageDescription | null {
  const name = FILENAME_LANGUAGE[basename.toLowerCase()];
  const byName = name ? languages.find(l => l.name === name) : undefined;
  if (byName) return byName;
  const e = ext.toLowerCase();
  return languages.find(l => l.extensions.includes(e)) ?? null;
}
