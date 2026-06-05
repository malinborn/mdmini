import { describe, it, expect } from 'vitest';
import { findCodeLanguage, FILENAME_LANGUAGE } from './file-language';

describe('findCodeLanguage', () => {
  describe('extensionless shell config dotfiles', () => {
    it.each(Object.keys(FILENAME_LANGUAGE))('every mapped dotfile %s resolves to a real descriptor', (file) => {
      const lang = findCodeLanguage(file, file.replace(/^\./, ''));
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe(FILENAME_LANGUAGE[file]);
    });

    it('resolves .zshrc to Shell', () => {
      const lang = findCodeLanguage('.zshrc', 'zshrc');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .bashrc to Shell', () => {
      const lang = findCodeLanguage('.bashrc', 'bashrc');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .bash_profile to Shell', () => {
      const lang = findCodeLanguage('.bash_profile', 'bash_profile');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .profile to Shell', () => {
      const lang = findCodeLanguage('.profile', 'profile');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .zshenv to Shell', () => {
      const lang = findCodeLanguage('.zshenv', 'zshenv');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .zprofile to Shell', () => {
      const lang = findCodeLanguage('.zprofile', 'zprofile');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .aliases to Shell', () => {
      const lang = findCodeLanguage('.aliases', 'aliases');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves .functions to Shell', () => {
      const lang = findCodeLanguage('.functions', 'functions');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('is case-insensitive for basename', () => {
      const lang = findCodeLanguage('.ZSHRC', 'ZSHRC');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });
  });

  describe('extension fallback', () => {
    it('resolves Python by extension', () => {
      const lang = findCodeLanguage('foo.py', 'py');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Python');
    });

    it('resolves Rust by extension', () => {
      const lang = findCodeLanguage('foo.rs', 'rs');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Rust');
    });

    it('resolves Shell by .sh extension', () => {
      const lang = findCodeLanguage('deploy.sh', 'sh');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('resolves Shell by .bash extension', () => {
      const lang = findCodeLanguage('script.bash', 'bash');
      expect(lang).not.toBeNull();
      expect(lang?.name).toBe('Shell');
    });

    it('returns null for unknown extension', () => {
      const lang = findCodeLanguage('mystery.xyz', 'xyz');
      expect(lang).toBeNull();
    });

    it('does NOT match non-shell dotfiles (allowlist only)', () => {
      // .gitignore/.dockerignore/.editorconfig deliberately stay plain text
      expect(findCodeLanguage('.gitignore', 'gitignore')).toBeNull();
      expect(findCodeLanguage('.dockerignore', 'dockerignore')).toBeNull();
      expect(findCodeLanguage('.editorconfig', 'editorconfig')).toBeNull();
    });

    it('returns null for an extensionless file with empty ext', () => {
      // bare basename, no dot → ext '' must not match any language
      expect(findCodeLanguage('makefile', '')).toBeNull();
    });

    it('resolves Markdown by extension', () => {
      const lang = findCodeLanguage('notes.md', 'md');
      // language-data includes Markdown; main point is extension path works
      expect(lang).not.toBeNull();
    });
  });
});
