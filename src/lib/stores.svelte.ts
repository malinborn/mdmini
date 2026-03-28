type ThemeSetting = 'light' | 'dark' | 'system';
type EditorMode = 'live-preview' | 'raw';

function loadSetting<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`md-mini:${key}`);
    return raw !== null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveSetting(key: string, value: unknown): void {
  localStorage.setItem(`md-mini:${key}`, JSON.stringify(value));
}

export function createThemeStore() {
  let preference = $state<ThemeSetting>(loadSetting('theme', 'system'));
  let systemDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);

  const resolved = $derived<'light' | 'dark'>(
    preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  );

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    systemDark = e.matches;
  });

  return {
    get preference() {
      return preference;
    },
    set preference(v: ThemeSetting) {
      preference = v;
      saveSetting('theme', v);
    },
    get resolved() {
      return resolved;
    },
  };
}

export function createModeStore() {
  let mode = $state<EditorMode>(loadSetting('mode', 'live-preview'));

  return {
    get value() {
      return mode;
    },
    toggle() {
      mode = mode === 'live-preview' ? 'raw' : 'live-preview';
      saveSetting('mode', mode);
    },
  };
}

export function createZoomStore() {
  let level = $state<number>(loadSetting('zoomLevel', 1.0));

  return {
    get level() {
      return level;
    },
    zoomIn() {
      if (level < 2.0) {
        level = Math.round((level + 0.1) * 10) / 10;
        saveSetting('zoomLevel', level);
      }
    },
    zoomOut() {
      if (level > 0.8) {
        level = Math.round((level - 0.1) * 10) / 10;
        saveSetting('zoomLevel', level);
      }
    },
    reset() {
      level = 1.0;
      saveSetting('zoomLevel', level);
    },
  };
}

export function createFileState() {
  let filePath = $state<string | null>(null);
  let isDirty = $state(false);
  let lastSavedAt = $state<number | null>(null);

  return {
    get filePath() {
      return filePath;
    },
    set filePath(v: string | null) {
      filePath = v;
    },
    get isDirty() {
      return isDirty;
    },
    set isDirty(v: boolean) {
      isDirty = v;
    },
    get lastSavedAt() {
      return lastSavedAt;
    },
    set lastSavedAt(v: number | null) {
      lastSavedAt = v;
    },
    get title() {
      const name = filePath ? filePath.split('/').pop() : 'Untitled';
      return `${isDirty ? '\u25cf ' : ''}${name} \u2014 md-mini`;
    },
  };
}

export interface RecentFile {
  path: string;
  timestamp: number;
}

export function createRecentFilesStore() {
  let files = $state<RecentFile[]>(loadSetting('recentFiles', []));

  return {
    get list() {
      return files;
    },
    add(path: string) {
      files = [
        { path, timestamp: Date.now() },
        ...files.filter((f) => f.path !== path),
      ].slice(0, 10);
      saveSetting('recentFiles', files);
    },
  };
}
