# Aurora Theme + Theme Switcher Fix — Design

**Date:** 2026-08-22
**Status:** Approved (palettes validated visually via HTML mockup)
**Goal:** Ship a brand theme pair (Aurora Light / Aurora Dark) matching the new app icon, and fix the Theme menu so checkmarks behave like radio buttons and reflect the persisted preference. Part of the v1.0 release.

## Context

The new icon: purple→teal diagonal gradient, white serif "md", pink→cyan gradient caret. The existing themes stay untouched ("Classic" light/dark). Aurora is added as a second theme family, each with a light and dark variant.

The current Theme menu is broken: `menu.rs` hardcodes a checkmark on System at build time, the actual preference lives in frontend localStorage and is never synced to the menu, and macOS natively toggles CheckMenuItems on click — so checkmarks accumulate on multiple items.

## Settings Model

```ts
type ThemeSetting = 'light' | 'dark' | 'aurora-light' | 'aurora-dark' | 'system';
type ThemeFamily = 'classic' | 'aurora';
```

- `preference: ThemeSetting` — persisted in localStorage (`md-mini:theme`), as today.
- `lastFamily: ThemeFamily` — persisted (`md-mini:themeFamily`, default `classic`). Updated whenever the user picks a concrete theme; **not** changed by picking System.
- `resolved` — one of the four concrete themes:
  - explicit preference → itself;
  - `system` → OS light/dark **within `lastFamily`** (e.g. lastFamily=aurora + OS dark → `aurora-dark`).
- Store additionally exposes `isDark = resolved.endsWith('dark')` — for mermaid and anything else that only needs the appearance axis.
- `<html data-theme>` gets the resolved value (one of 4). CSS files select on it.

Migration: existing users have `'light' | 'dark' | 'system'` stored — all still valid values, no migration needed. Missing `themeFamily` defaults to `classic`.

## Theme Menu (flat list)

```
Theme ▸
    Light
    Dark
    Aurora Light
    Aurora Dark
  ─────────
  ✓ System
```

Menu item IDs: `theme_light`, `theme_dark`, `theme_aurora_light`, `theme_aurora_dark`, `theme_system`.

### Checkmark fix — single source of truth

1. `menu.rs` builds 5 `CheckMenuItem`s with **no** hardcoded `checked(true)`. `ThemeMenuItems` (all 5 handles) is stored in Tauri managed state.
2. New IPC command `sync_theme_menu(preference: String)` in `commands.rs`: sets `checked` on exactly the item matching the preference, unchecks the rest.
3. Frontend calls `sync_theme_menu` (a) once on startup with the persisted preference, (b) inside the preference setter on every change. This also corrects macOS's native toggle after a click.
4. The radio logic currently in `lib.rs`'s `on_menu_event` is removed — the menu-event is still broadcast to windows; the frontend applies the preference and syncs back. One writer, no divergence.

Multi-window: the menu is app-global; every window's store reacts to the broadcast `menu-event` as today, and the sync command is idempotent so duplicate calls are harmless.

## Aurora Palettes

Both variants use Inter (sans-serif) — Aurora is the "calm" family without serif typography. Code font stays JetBrains Mono. Primary violet is deliberately cool (shifted toward blue); the warm violet appears only as the italic accent. Caret is a vertical pink→cyan gradient like the icon.

### Aurora Dark (`src/lib/theme/aurora-dark.css`, `:root[data-theme='aurora-dark']`)

| Token | Value |
|---|---|
| `--bg-base` | `#171629` |
| `--bg-surface` | `#1f1e35` |
| `--text-primary` | `#e4e4f2` |
| `--text-subtle` | `#9192b3` |
| `--text-muted` | `#6a6b8c` |
| `--highlight` | `#353456` |
| `--color-heading` | `#8f9ff5` |
| `--color-bold` | `#f28cc7` |
| `--color-italic` | `#c3a9f7` |
| `--color-link` | `#6fd9c0` |
| `--color-code-bg` | `#1f1e35` |
| `--color-code-text` | `#e4e4f2` |
| `--color-selection` | `#3d3c62` |
| `--color-border` | `#353456` |
| `--color-cursor` | `#f78cc7` (fallback for `caretColor`) |
| `--color-caret-top` | `#f78cc7` |
| `--color-caret-bottom` | `#7edff2` |
| `--color-line-highlight` | `#1f1e35` |
| `--color-strikethrough` | `#9192b3` |
| `--color-blockquote-border` | `#8f9ff5` |
| `--color-hr` | `#353456` |
| `--color-list-marker` | `#9192b3` |
| `--color-checkbox` | `#6fd9c0` |
| `--color-table-border` | `#353456` |
| `--color-table-header-bg` | `#1f1e35` |
| `--color-table-even-bg` | `#252340` |
| `--color-glow` | `143, 159, 245` |
| `--bg-overlay` | `rgba(23, 22, 41, 0.75)` |
| `--border` | `#353456` |
| `--font-text` | `'Inter', -apple-system, system-ui, sans-serif` |
| `--font-code` | `'JetBrains Mono', 'SF Mono', monospace` |

### Aurora Light (`src/lib/theme/aurora-light.css`, `:root[data-theme='aurora-light']`)

The signature feature: the editor background is a **very subtle long diagonal gradient** in desaturated eggshell tones — grayish blue-green → gray → light peachy (user-picked variant "B" from the mockup iterations). `--bg-base` stays a solid mid-tone for components that need a plain color (surfaces, overlays).

| Token | Value |
|---|---|
| `--bg-base` | `#efeeec` |
| `--bg-image` | `linear-gradient(150deg, #e7edea 0%, #efeeec 55%, #f6efe7 100%)` |
| `--bg-surface` | `#e9e8e3` |
| `--text-primary` | `#262a45` |
| `--text-subtle` | `#6b6f92` |
| `--text-muted` | `#a19e97` |
| `--highlight` | `#e5e4de` |
| `--color-heading` | `#5566ec` |
| `--color-bold` | `#d6438f` |
| `--color-italic` | `#8b6ce8` |
| `--color-link` | `#0d9488` |
| `--color-code-bg` | `#e9e8e3` |
| `--color-code-text` | `#262a45` |
| `--color-selection` | `#d9ddf8` |
| `--color-border` | `#dddcd5` |
| `--color-cursor` | `#e0509f` (fallback for `caretColor`) |
| `--color-caret-top` | `#e0509f` |
| `--color-caret-bottom` | `#2bb3d9` |
| `--color-line-highlight` | `#e9e8e3` |
| `--color-strikethrough` | `#6b6f92` |
| `--color-blockquote-border` | `#5566ec` |
| `--color-hr` | `#dddcd5` |
| `--color-list-marker` | `#6b6f92` |
| `--color-checkbox` | `#0d9488` |
| `--color-table-border` | `#dddcd5` |
| `--color-table-header-bg` | `#e9e8e3` |
| `--color-table-even-bg` | `#edece7` |
| `--color-glow` | `85, 102, 236` |
| `--bg-overlay` | `rgba(239, 238, 236, 0.75)` |
| `--border` | `#dddcd5` |
| `--font-text` | `'Inter', -apple-system, system-ui, sans-serif` |
| `--font-code` | `'JetBrains Mono', 'SF Mono', monospace` |

### Gradient background mechanism

New optional token `--bg-image`. The `editor-theme.ts` root rule (`'&'`) gains `backgroundImage: 'var(--bg-image, none)'`; themes without the token (classic pair, aurora-dark) fall back to `none` and keep their solid `--bg-base`. The gradient sits on the editor root, which is window-sized (`.cm-scroller` scrolls inside it), so it does not scroll with content. `.cm-gutters` background becomes `transparent` so it doesn't paint a solid strip over the gradient — visually identical in solid themes, where it previously matched `--bg-base` anyway. Verify visually: an equal-specificity solid `background` rule declared later can silently override the gradient (this bit the HTML mockup).

### Gradient caret

`editor-theme.ts` styles `.cm-cursor` with `border-left`. Add:

```
borderImage: 'linear-gradient(180deg, var(--color-caret-top, var(--color-cursor)), var(--color-caret-bottom, var(--color-cursor))) 1'
```

Classic themes don't define the caret tokens, so the fallback keeps their solid caret. `caretColor` on `.cm-content` keeps using `--color-cursor`. If `border-image` misbehaves in WKWebView, fallback plan: solid pink caret in Aurora (verify during implementation in the browser first).

## Affected Files

| File | Change |
|---|---|
| `src/lib/theme/aurora-dark.css` | new |
| `src/lib/theme/aurora-light.css` | new |
| `src/lib/theme/editor-theme.ts` | gradient caret via border-image |
| `src/lib/stores.svelte.ts` | ThemeSetting union, lastFamily, resolved logic, isDark |
| `src/App.svelte` | import aurora CSS, menu-event cases, `sync_theme_menu` invoke on startup + change |
| `src/lib/editor/preview/mermaid.ts` | dark detection via `isDark` / suffix instead of `=== 'dark'` (verify current logic) |
| `src-tauri/src/menu.rs` | 5 check items, no hardcoded check, separator before System |
| `src-tauri/src/lib.rs` | remove radio logic from `on_menu_event`, manage `ThemeMenuItems` state |
| `src-tauri/src/commands.rs` | `sync_theme_menu` command |

## Testing

- Vitest: theme store resolve matrix — each explicit preference; system × (classic, aurora) × (OS light, OS dark); lastFamily persistence rules; isDark.
- `cargo test`: existing tests still pass (sync command is thin, exercised manually).
- Manual (`npm run dev` in browser): all four `data-theme` values render correctly — headings, bold/italic, links, code, tables, checkboxes, selection, caret gradient, line glow, mermaid re-theme.
- Manual (`npm run dev:app`): menu checkmarks — exactly one check at all times, correct check on startup after relaunch, System behavior in both families.

## Out of Scope

- The icon swap (handled by a parallel agent).
- The v1.0 release itself (`brew-release` afterwards, once icon + theme are merged).
- Any redesign of the classic themes.
