# Aurora Theme + Theme Switcher Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Aurora brand theme pair (light + dark, icon palette) and make the Theme menu a real radio group synced with the persisted preference.

**Architecture:** Theme resolution becomes a pure function (`resolveTheme`) consumed by the runes store; `data-theme` on `<html>` takes one of four concrete values selected by new/existing CSS files. The Rust menu exposes 5 CheckMenuItems whose checkmarks are set from a single IPC command `sync_theme_menu`, called by the frontend on startup and on every preference change.

**Tech Stack:** Svelte 5 runes, CodeMirror 6 theme (CSS vars), Tauri 2 (menu + command), Vitest, cargo test.

**Spec:** `docs/superpowers/specs/2026-08-22-aurora-theme-design.md` — palettes there are authoritative.

---

### Task 1: Pure theme resolution module (TDD)

Vitest runs in a node environment (no DOM), so resolution logic lives in a plain TS module with no `window` access.

**Files:**
- Create: `src/lib/theme-resolve.ts`
- Test: `src/lib/theme-resolve.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/lib/theme-resolve.test.ts
import { describe, it, expect } from 'vitest';
import { resolveTheme, familyOf, isDarkTheme } from './theme-resolve';

describe('resolveTheme', () => {
  it('ExplicitPreference_ReturnsItself', () => {
    expect(resolveTheme('light', 'classic', true)).toBe('light');
    expect(resolveTheme('dark', 'aurora', false)).toBe('dark');
    expect(resolveTheme('aurora-light', 'classic', true)).toBe('aurora-light');
    expect(resolveTheme('aurora-dark', 'classic', false)).toBe('aurora-dark');
  });

  it('System_ClassicFamily_FollowsOs', () => {
    expect(resolveTheme('system', 'classic', false)).toBe('light');
    expect(resolveTheme('system', 'classic', true)).toBe('dark');
  });

  it('System_AuroraFamily_FollowsOs', () => {
    expect(resolveTheme('system', 'aurora', false)).toBe('aurora-light');
    expect(resolveTheme('system', 'aurora', true)).toBe('aurora-dark');
  });
});

describe('familyOf', () => {
  it('MapsConcreteThemesToFamilies', () => {
    expect(familyOf('light')).toBe('classic');
    expect(familyOf('dark')).toBe('classic');
    expect(familyOf('aurora-light')).toBe('aurora');
    expect(familyOf('aurora-dark')).toBe('aurora');
  });
});

describe('isDarkTheme', () => {
  it('DetectsDarkVariants', () => {
    expect(isDarkTheme('dark')).toBe(true);
    expect(isDarkTheme('aurora-dark')).toBe(true);
    expect(isDarkTheme('light')).toBe(false);
    expect(isDarkTheme('aurora-light')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/theme-resolve.test.ts`
Expected: FAIL — cannot resolve `./theme-resolve`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lib/theme-resolve.ts
export type ThemeSetting = 'light' | 'dark' | 'aurora-light' | 'aurora-dark' | 'system';
export type ConcreteTheme = Exclude<ThemeSetting, 'system'>;
export type ThemeFamily = 'classic' | 'aurora';

export function familyOf(theme: ConcreteTheme): ThemeFamily {
  return theme.startsWith('aurora') ? 'aurora' : 'classic';
}

export function isDarkTheme(theme: ConcreteTheme): boolean {
  return theme.endsWith('dark');
}

/** System follows the OS appearance within the last explicitly chosen family. */
export function resolveTheme(
  preference: ThemeSetting,
  lastFamily: ThemeFamily,
  systemDark: boolean
): ConcreteTheme {
  if (preference !== 'system') return preference;
  if (lastFamily === 'aurora') return systemDark ? 'aurora-dark' : 'aurora-light';
  return systemDark ? 'dark' : 'light';
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/theme-resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme-resolve.ts src/lib/theme-resolve.test.ts
git commit -m "feat(theme): pure theme resolution with family-aware system mode"
```

---

### Task 2: Theme store — lastFamily + resolved + isDark

**Files:**
- Modify: `src/lib/stores.svelte.ts:1-41` (type + `createThemeStore`)

- [ ] **Step 1: Replace the ThemeSetting type and createThemeStore**

At the top of `src/lib/stores.svelte.ts`, delete the line `type ThemeSetting = 'light' | 'dark' | 'system';` and add the import:

```ts
import {
  resolveTheme,
  familyOf,
  isDarkTheme,
  type ThemeSetting,
  type ThemeFamily,
  type ConcreteTheme,
} from './theme-resolve';
```

Replace the whole `createThemeStore` function with:

```ts
export function createThemeStore() {
  let preference = $state<ThemeSetting>(loadSetting('theme', 'system'));
  let lastFamily = $state<ThemeFamily>(loadSetting('themeFamily', 'classic'));
  let systemDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);

  const resolved = $derived<ConcreteTheme>(resolveTheme(preference, lastFamily, systemDark));
  const isDark = $derived(isDarkTheme(resolved));

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
      if (v !== 'system') {
        lastFamily = familyOf(v);
        saveSetting('themeFamily', lastFamily);
      }
    },
    get resolved() {
      return resolved;
    },
    get isDark() {
      return isDark;
    },
  };
}
```

Note: `EditorMode` and the rest of the file stay untouched. Existing persisted values (`'light' | 'dark' | 'system'`) remain valid members of the widened union — no migration.

- [ ] **Step 2: Type-check and run the full frontend suite**

Run: `npm run check && npx vitest run --dir src`
Expected: 0 svelte-check errors; all tests pass (252 + 5 new).

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores.svelte.ts
git commit -m "feat(theme): family-aware theme store with isDark"
```

---

### Task 3: Aurora CSS palettes

**Files:**
- Create: `src/lib/theme/aurora-dark.css`
- Create: `src/lib/theme/aurora-light.css`
- Modify: `src/App.svelte:41-42` (imports)

- [ ] **Step 1: Create `src/lib/theme/aurora-dark.css`**

```css
:root[data-theme='aurora-dark'] {
  --bg-base: #171629;
  --bg-surface: #1f1e35;
  --text-primary: #e4e4f2;
  --text-subtle: #9192b3;
  --text-muted: #6a6b8c;
  --highlight: #353456;
  --color-heading: #8f9ff5;
  --color-bold: #f28cc7;
  --color-italic: #c3a9f7;
  --color-link: #6fd9c0;
  --color-code-bg: #1f1e35;
  --color-code-text: #e4e4f2;
  --color-selection: #3d3c62;
  --color-border: #353456;
  --color-cursor: #f78cc7;
  --color-caret-top: #f78cc7;
  --color-caret-bottom: #7edff2;
  --color-line-highlight: #1f1e35;
  --color-strikethrough: #9192b3;
  --color-blockquote-border: #8f9ff5;
  --color-hr: #353456;
  --color-list-marker: #9192b3;
  --color-checkbox: #6fd9c0;
  --color-table-border: #353456;
  --color-table-header-bg: #1f1e35;
  --color-table-even-bg: #252340;
  --color-glow: 143, 159, 245;
  --bg-overlay: rgba(23, 22, 41, 0.75);
  --border: #353456;
  --font-text: 'Inter', -apple-system, system-ui, sans-serif;
  --font-code: 'JetBrains Mono', 'SF Mono', monospace;
}
```

- [ ] **Step 2: Create `src/lib/theme/aurora-light.css`**

```css
:root[data-theme='aurora-light'] {
  --bg-base: #f9faff;
  --bg-surface: #f0f1fb;
  --text-primary: #262a45;
  --text-subtle: #6b6f92;
  --text-muted: #9da1c0;
  --highlight: #e1e3f5;
  --color-heading: #5566ec;
  --color-bold: #d6438f;
  --color-italic: #8b6ce8;
  --color-link: #0d9488;
  --color-code-bg: #f0f1fb;
  --color-code-text: #262a45;
  --color-selection: #d9ddf8;
  --color-border: #e1e3f5;
  --color-cursor: #e0509f;
  --color-caret-top: #e0509f;
  --color-caret-bottom: #2bb3d9;
  --color-line-highlight: #f0f1fb;
  --color-strikethrough: #6b6f92;
  --color-blockquote-border: #5566ec;
  --color-hr: #e1e3f5;
  --color-list-marker: #6b6f92;
  --color-checkbox: #0d9488;
  --color-table-border: #e1e3f5;
  --color-table-header-bg: #f0f1fb;
  --color-table-even-bg: #f2f3fc;
  --color-glow: 85, 102, 236;
  --bg-overlay: rgba(249, 250, 255, 0.75);
  --border: #e1e3f5;
  --font-text: 'Inter', -apple-system, system-ui, sans-serif;
  --font-code: 'JetBrains Mono', 'SF Mono', monospace;
}
```

- [ ] **Step 3: Import both files in `src/App.svelte`**

After the existing lines `import './lib/theme/dark.css';` / `import './lib/theme/light.css';` add:

```ts
  import './lib/theme/aurora-dark.css';
  import './lib/theme/aurora-light.css';
```

- [ ] **Step 4: Verify in browser**

Run: `npm run dev` (background), open http://localhost:1420, then in DevTools console:
`document.documentElement.setAttribute('data-theme', 'aurora-dark')` and `'aurora-light'`.
Expected: full palette switches (background, headings violet-blue, bold pink, links teal). Alternatively use Playwright MCP (`browser_navigate` + `browser_evaluate` + `browser_take_screenshot`).

- [ ] **Step 5: Commit**

```bash
git add src/lib/theme/aurora-dark.css src/lib/theme/aurora-light.css src/App.svelte
git commit -m "feat(theme): aurora light + dark palettes"
```

---

### Task 4: Gradient caret

**Files:**
- Modify: `src/lib/theme/editor-theme.ts:14-17`

- [ ] **Step 1: Extend the `.cm-cursor` rule**

Replace:

```ts
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-cursor)',
    borderLeftWidth: '2px',
  },
```

with:

```ts
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--color-cursor)',
    borderLeftWidth: '2px',
    borderImage:
      'linear-gradient(180deg, var(--color-caret-top, var(--color-cursor)), var(--color-caret-bottom, var(--color-cursor))) 1',
  },
```

Classic themes define no caret tokens, so the fallback keeps their solid caret color.

- [ ] **Step 2: Verify in browser**

With `npm run dev` still running and `data-theme='aurora-dark'`: click into the editor — the caret is a pink→cyan vertical gradient. Switch `data-theme` to `'dark'` — caret is solid `#e0def4` again. If WebKit renders the border-image caret at zero width or black, fall back: remove `borderImage` and keep the solid `--color-cursor` pink caret (note the deviation in the commit message and spec).

- [ ] **Step 3: Commit**

```bash
git add src/lib/theme/editor-theme.ts
git commit -m "feat(theme): gradient caret via border-image with solid fallback"
```

---

### Task 5: Mermaid dark detection for aurora

**Files:**
- Modify: `src/lib/editor/preview/mermaid.ts:36-38`

- [ ] **Step 1: Fix `currentTheme()`**

Replace:

```ts
function currentTheme(): 'default' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
}
```

with:

```ts
function currentTheme(): 'default' | 'dark' {
  return document.documentElement.dataset.theme?.endsWith('dark') ? 'dark' : 'default';
}
```

- [ ] **Step 2: Type-check**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/editor/preview/mermaid.ts
git commit -m "fix(mermaid): treat aurora-dark as dark theme"
```

---

### Task 6: Frontend — menu cases + sync_theme_menu invoke

**Files:**
- Modify: `src/lib/tauri/commands.ts` (add wrapper)
- Modify: `src/App.svelte:595-603` (menu cases) and the theme `$effect` (~line 709)

- [ ] **Step 1: Add the IPC wrapper in `src/lib/tauri/commands.ts`**

```ts
/** Sets the Theme menu checkmarks; harmless no-op outside Tauri (browser dev). */
export function syncThemeMenu(preference: string): void {
  invoke('sync_theme_menu', { preference }).catch(() => {});
}
```

- [ ] **Step 2: Add the two menu-event cases in `src/App.svelte`**

After `case 'theme_dark': ... break;` add:

```ts
        case 'theme_aurora_light':
          theme.preference = 'aurora-light';
          break;
        case 'theme_aurora_dark':
          theme.preference = 'aurora-dark';
          break;
```

- [ ] **Step 3: Sync the menu from the theme effect**

Import `syncThemeMenu` alongside the other imports from `./lib/tauri/commands` in App.svelte. Then extend the existing effect:

```ts
  $effect(() => {
    document.documentElement.setAttribute('data-theme', theme.resolved);
    reinitializeTheme();
  });

  $effect(() => {
    syncThemeMenu(theme.preference);
  });
```

A separate effect: it must depend on `preference` (not `resolved`), and it runs once on mount — that is the startup sync.

- [ ] **Step 4: Type-check + tests**

Run: `npm run check && npx vitest run --dir src`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri/commands.ts src/App.svelte
git commit -m "feat(theme): aurora menu actions and menu checkmark sync"
```

---

### Task 7: Rust — 5-item radio menu + sync command

**Files:**
- Modify: `src-tauri/src/menu.rs` (ThemeMenuItems struct + theme submenu build)
- Modify: `src-tauri/src/lib.rs` (manage state, drop radio block from `on_menu_event`, register command)
- Modify: `src-tauri/src/commands.rs` (new command)

- [ ] **Step 1: Extend `ThemeMenuItems` and the submenu in `src-tauri/src/menu.rs`**

Replace the struct:

```rust
pub struct ThemeMenuItems {
    pub light: CheckMenuItem<Wry>,
    pub dark: CheckMenuItem<Wry>,
    pub aurora_light: CheckMenuItem<Wry>,
    pub aurora_dark: CheckMenuItem<Wry>,
    pub system: CheckMenuItem<Wry>,
}

impl ThemeMenuItems {
    /// Single writer for the Theme checkmarks: checks exactly the item
    /// matching the preference ("light" | "dark" | "aurora-light" |
    /// "aurora-dark" | "system"), unchecks the rest.
    pub fn sync(&self, preference: &str) {
        let _ = self.light.set_checked(preference == "light");
        let _ = self.dark.set_checked(preference == "dark");
        let _ = self.aurora_light.set_checked(preference == "aurora-light");
        let _ = self.aurora_dark.set_checked(preference == "aurora-dark");
        let _ = self.system.set_checked(preference == "system");
    }
}
```

Replace the theme item construction (currently `theme_light`/`theme_dark`/`theme_system` with `.checked(true)` on system) and submenu with:

```rust
    let theme_light = CheckMenuItemBuilder::with_id("theme_light", "Light").build(app)?;
    let theme_dark = CheckMenuItemBuilder::with_id("theme_dark", "Dark").build(app)?;
    let theme_aurora_light =
        CheckMenuItemBuilder::with_id("theme_aurora_light", "Aurora Light").build(app)?;
    let theme_aurora_dark =
        CheckMenuItemBuilder::with_id("theme_aurora_dark", "Aurora Dark").build(app)?;
    let theme_system = CheckMenuItemBuilder::with_id("theme_system", "System").build(app)?;

    let theme_menu = SubmenuBuilder::new(app, "Theme")
        .item(&theme_light)
        .item(&theme_dark)
        .item(&theme_aurora_light)
        .item(&theme_aurora_dark)
        .separator()
        .item(&theme_system)
        .build()?;
```

And the struct literal at the end of `build_menu`:

```rust
    let theme_items = ThemeMenuItems {
        light: theme_light,
        dark: theme_dark,
        aurora_light: theme_aurora_light,
        aurora_dark: theme_aurora_dark,
        system: theme_system,
    };
```

No hardcoded `.checked(true)` anywhere — the frontend startup sync sets the initial state.

- [ ] **Step 2: Manage the items and drop the radio block in `src-tauri/src/lib.rs`**

After `let (menu, theme_items) = menu::build_menu(app.handle(), pending_count)?; app.set_menu(menu)?;` add:

```rust
            app.manage(theme_items);
```

Delete the block:

```rust
                // Handle theme switching — radio behavior via direct CheckMenuItem refs
                if id.starts_with("theme_") {
                    let _ = theme_items.light.set_checked(id == "theme_light");
                    let _ = theme_items.dark.set_checked(id == "theme_dark");
                    let _ = theme_items.system.set_checked(id == "theme_system");
                }
```

(The closure then no longer captures `theme_items`; the menu-event broadcast below it stays.)

Register the command in `invoke_handler` — add to the `generate_handler![...]` list:

```rust
            commands::sync_theme_menu,
```

- [ ] **Step 3: Add the command in `src-tauri/src/commands.rs`**

```rust
/// Sets the Theme menu checkmarks to match the frontend's persisted
/// preference. Called on startup and on every theme change — the only
/// writer of these checkmarks (macOS toggles the clicked item natively;
/// this call corrects it).
#[command]
pub async fn sync_theme_menu(
    state: tauri::State<'_, crate::menu::ThemeMenuItems>,
    preference: String,
) -> Result<(), String> {
    state.sync(&preference);
    Ok(())
}
```

If `app.manage(theme_items)` fails to compile because `CheckMenuItem<Wry>` is not `Send + Sync` on macOS: wrap access via `app.run_on_main_thread` with the items held in a `std::sync::Mutex<Option<ThemeMenuItems>>` static-style managed wrapper — but verify the plain version first; Tauri 2 menu items are designed to be called from any thread.

- [ ] **Step 4: Compile, lint, test**

Run: `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test`
Expected: clean build, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/menu.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "fix(menu): 5-theme radio group synced from a single IPC command"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full frontend suite + type-check**

Run: `npm run check && npx vitest run --dir src`
Expected: clean, 257 tests.

- [ ] **Step 2: Browser visual pass (all four themes)**

`npm run dev` + Playwright MCP (or manual): for each of `light`, `dark`, `aurora-light`, `aurora-dark` set `data-theme`, load a document with headings/bold/italic/links/code/table/checkboxes/mermaid, screenshot, eyeball. Focus points: gradient caret in aurora, mermaid re-renders dark in aurora-dark, tables/selection contrast.

- [ ] **Step 3: Tauri menu behavior (`npm run dev:app`)**

Kill port 1420 first if busy (`lsof -ti:1420 | xargs kill -9`). Then verify via the Tauri MCP bridge or manually:
1. Theme menu shows 5 items, exactly one checked (matches persisted preference) right after launch.
2. Click each theme — checkmark moves, colors change, no double-checks.
3. Pick Aurora Dark, then System — resolved theme follows OS appearance within aurora family.
4. Relaunch the dev app — startup checkmark matches what was chosen.

- [ ] **Step 4: Final commit (if fixes were needed) and report**

Report results with screenshots; any deviation from spec (e.g. border-image fallback) documented in the spec file.

---

### Task 9: Docs touch-up

**Files:**
- Modify: `CLAUDE.md` (architecture section, theme dir line)

- [ ] **Step 1: Update the theme dir line in CLAUDE.md architecture block**

Change `src/lib/theme/            # CSS variables + CM6 theme` to mention four theme files:

```
  lib/theme/            # CSS variables (light/dark + aurora-light/aurora-dark) + CM6 theme
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: aurora theme files in architecture map"
```
