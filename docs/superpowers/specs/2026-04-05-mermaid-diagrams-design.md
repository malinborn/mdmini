# Mermaid Diagrams Live Preview — Design Spec

## Overview

Add live-preview rendering of Mermaid diagrams inside fenced code blocks (` ```mermaid `). When the cursor is outside the block, the raw code is replaced by a rendered SVG diagram. When the cursor enters the block, raw mermaid code is shown for editing. Matches md-mini's existing live-preview philosophy.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Display mode | Inline replacement (A) | Matches md-mini live-preview pattern |
| Error handling | Hybrid (C) | Show last valid render + error overlay at bottom |
| Bundle strategy | Full mermaid + lazy load | All diagram types supported, zero cost if no mermaid blocks |
| Syntax highlighting | Plain text (A) | No extra deps, add `codemirror-lang-mermaid` later if needed |
| Interactivity | Static SVG (A) | Pan/zoom and click-through can be added later |
| Architecture | ViewPlugin + StateEffect | Standard CM6 async pattern, no external state |

## File Structure

### New file: `src/lib/editor/preview/mermaid.ts`

Contains all mermaid-related logic:
- `MermaidWidget` class (extends `WidgetType`)
- Lazy-loader for mermaid module
- Content-addressed render cache
- Debounced render logic with sequential queue
- `mermaidRendered` StateEffect for triggering decoration rebuilds
- Export function called from `plugin.ts`

### Modified files

- `src/lib/editor/preview/plugin.ts` — detect `FencedCode` with language `mermaid`, delegate to `mermaid.ts`
- `src/styles/` — CSS for mermaid container, placeholder, error overlay

No changes to `setup.ts`, `blocks.ts`, or other preview modules.

## Rendering Pipeline

### 1. Detection

`plugin.ts` encounters `FencedCode` node, extracts language from opening fence. If language is `mermaid`, delegates to mermaid module instead of normal code block decoration.

### 2. Lazy Load

First invocation triggers:
```typescript
const mermaid = await import('mermaid');
mermaid.default.initialize({ startOnLoad: false, theme: 'default' });
```
Module reference cached in a module-level variable. Subsequent calls use the cached reference.

### 3. Cache Lookup

Cache is a `Map<string, { svg: string; error?: string }>` keyed by mermaid source text (content-addressed).

- Cache hit → use immediately, no async render needed
- Cache miss → trigger async render

### 4. Decoration

When cursor is **outside** the block:
- Cache hit with SVG → `Decoration.replace()` with `MermaidWidget` showing rendered SVG
- Cache miss → `Decoration.replace()` with `MermaidWidget` showing placeholder ("Rendering diagram...")
- Error with last valid SVG → `MermaidWidget` showing SVG + error overlay

When cursor is **inside** the block:
- No mermaid decoration applied — raw code visible (standard `cursorInRange()` behavior)

Fence lines (opening ` ```mermaid ` and closing ` ``` `) are hidden via CSS `display: none`, same as code blocks.

### 5. Async Render

On cache miss or source text change:
1. Debounce 300ms per block (keyed by document position)
2. Call `mermaid.render(id, source)` → returns `{ svg }`
3. On success → update cache with SVG, dispatch `mermaidRendered` StateEffect
4. On error → update cache with last valid SVG + error string, dispatch effect

### 6. StateEffect

A single `mermaidRendered` effect type. When the ViewPlugin sees this effect in its `update()` method, it triggers a decoration rebuild. The cache is now populated, so the rebuild picks up the rendered SVG.

### 7. Theme Sync

Read md-mini's current theme (light/dark) from the theme store. Pass corresponding mermaid theme (`'default'` for light, `'dark'` for dark) to `mermaid.initialize()`. On theme change, clear the render cache and re-render all visible mermaid blocks.

## Widget Design

### MermaidWidget

```
class MermaidWidget extends WidgetType {
  constructor(source: string, svg: string | null, error: string | null)

  eq(other): compare source + svg presence + error presence
  toDOM(): returns <div class="cm-md-mermaid-container">
}
```

### DOM Structure

**Successful render:**
```html
<div class="cm-md-mermaid-container">
  <svg>...</svg>
</div>
```

**Placeholder (cache miss):**
```html
<div class="cm-md-mermaid-container">
  <div class="cm-md-mermaid-placeholder">Rendering diagram...</div>
</div>
```

**Error with last valid SVG:**
```html
<div class="cm-md-mermaid-container">
  <svg>...</svg>
  <div class="cm-md-mermaid-error">⚠ Parse error at line 3: Expected node identifier</div>
</div>
```

**Error without prior valid SVG:**
```html
<div class="cm-md-mermaid-container">
  <div class="cm-md-mermaid-error">⚠ Parse error at line 3: Expected node identifier</div>
</div>
```

### Error Overlay

- Positioned at the bottom of the container
- Compact: 1–2 lines, truncated if verbose
- Warning background (subtle yellow/orange, adapts to light/dark theme)
- Disappears when syntax becomes valid

## Debounce & Performance

### Debounce
- 300ms per block, keyed by block position in document
- Each keystroke inside a mermaid block resets that block's timer
- Only the latest source text is rendered — intermediate states discarded

### Concurrency
- Mermaid cannot render concurrently (single internal state machine)
- Sequential queue: if render in progress, queue next request
- Superseded queue items (same block, newer source) are dropped

### Multiple Blocks
- Each block has its own debounce timer
- Renders processed sequentially through the queue
- Content-addressed cache means identical blocks share a single render result

### Memory
- Cache capped at 50 entries, LRU eviction
- Typical SVG: 5–50 KB, worst case ~2.5 MB total
- Cache is module-level, persists across document switches (acceptable for desktop app)

### Render IDs
- Mermaid requires unique element IDs: use incrementing counter `mermaid-render-${counter++}`
- Mermaid uses a temp element for rendering — does not need to be in visible DOM

## Dependencies

### New
- `mermaid` (latest) — lazy-loaded, full package

### No new dependencies for
- Syntax highlighting (plain text for v1)
- Interactivity (static SVG for v1)

## Future Extensions (Out of Scope)

- **Pan/zoom** on large diagrams (~25/100 difficulty)
- **Click-through links** via mermaid's `bindFunctions` (~15/100 difficulty)
- **Syntax highlighting** via `codemirror-lang-mermaid` package
- **Mermaid Tiny** if bundle size becomes a concern
