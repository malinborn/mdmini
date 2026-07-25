# Mermaid Pan & Zoom — Design

**Date:** 2026-07-25
**Status:** Approved

## Goal

Make rendered mermaid diagrams navigable: zoom in/out, pan around, and return to
a full view. Trackpad-first, in the spirit of Miro — pinch to zoom, two-finger
swipe to pan — without breaking the ability to scroll the document itself.

## Non-Goals

- Fullscreen / modal diagram viewer
- Persisting view state to disk or across sessions
- Editing the diagram graphically
- Keyboard navigation of the diagram

## Interaction Model

| Input | Behavior |
|---|---|
| Pinch (`wheel` + `ctrlKey`) | Zoom around the pointer. Always active. |
| `Cmd` + `wheel` | Same — for mice without pinch |
| Two-finger swipe (`wheel`) at `scale == fit` | **Not intercepted** — the document scrolls as it does today |
| Two-finger swipe at `scale > fit` | Pans the diagram, both axes (`deltaX` and `deltaY`) |
| …when already clamped at the edge in that direction | Event is released to the document (scroll chaining), so the diagram is never a scroll trap |
| Left-button drag | Pan. Always active. Cursor `grab` → `grabbing` |
| Double click | `scale != fit` → fit. Already at fit → zoom 2× at the pointer |
| `⤢` control | Fit, which also returns wheel scrolling to the document |
| Drag of the bottom handle | Resize the viewport frame height. Double click on the handle → auto height |

Trackpad inertia comes for free: macOS emits a decaying series of `wheel`
events, so panning coasts.

Controls, top-right, `opacity: 0` until the container is hovered (matching the
table controls): `−`, a percentage readout, `+`, `⤢`.

## Geometry

```
contentW/H = svg viewBox (never clientWidth — CSS has already distorted it)
fitScale   = min(1, vpW / contentW, vpH / contentH)   // never upscale small diagrams
autoHeight = clamp(contentH * min(1, vpW / contentW), 0, 60vh)
minScale   = min(0.1, fitScale)                       // a huge graph must still fit
maxScale   = 8
```

Pan is always clamped: on an axis where the scaled content is smaller than the
frame, the content is centered; otherwise the content edge may not move inside
the frame.

## Architecture

Three modules, with the boundary drawn so that the geometry knows nothing about
CodeMirror.

### `preview/mermaid-viewport.ts` (new)

Pure functions — `computeFit`, `clampPan`, `zoomAt`, `autoHeight`, `wheelIntent`
— operating on plain `{width, height}` / `{scale, tx, ty}` records with no DOM
access, so they are directly unit-testable. Alongside them, a DOM controller
`createViewport(svg, initial, onCommit)` that builds the frame and attaches the
listeners.

### `preview/mermaid-state.ts` (new)

A mirror of `table-state.ts`: a `StateField` holding a
`RangeSet<MermaidViewValue>`, remapped through `tr.changes`, written by a
`setMermaidView` effect and read by `getMermaidView(state, nodeFrom)`. The key
is a document position rather than the diagram source text, so the zoom level
survives an edit to the diagram body — the pan offset is re-clamped against the
new geometry.

### `preview/mermaid.ts` (modified)

The widget builds a viewport instead of a bare SVG. `eq()` is left alone: it
keeps comparing `source`, `svg` and `error`.

### Why not a transaction per frame

Pan and zoom write `transform` straight to the DOM, bypassing CodeMirror. The
`StateField` is only committed 150 ms after the last event. The alternative —
`wheel` → dispatch → `livePreviewPlugin.update` → a full decoration rebuild of
the document on every frame — would visibly lag.

A corollary: `livePreviewPlugin` must **not** subscribe to `setMermaidView` (as
it does for `toggleTableMode`). The visual result is already applied to the DOM,
so a rebuild would be pure waste.

### Why the state survives at all

During a pan, `eq()` returns `true`, CodeMirror reuses the DOM, and the
transform persists on its own. The `StateField` exists for the two cases where
the DOM really is rebuilt: the widget scrolled out of the editor viewport and
came back, or an edit to the source (or a theme switch) produced a new SVG.

## DOM & CSS

`max-width: 100%; height: auto` is removed from the SVG — the zoom math needs
the natural size.

```
.cm-md-mermaid-container   position: relative; overflow: hidden
  .cm-md-mermaid-viewport  height: Npx; overflow: hidden; touch-action: none
    .cm-md-mermaid-canvas  transform-origin: 0 0; will-change: transform
      svg                  width/height in px from the viewBox
  .cm-md-mermaid-controls  absolute, top-right
  .cm-md-mermaid-resize    absolute, bottom edge, cursor: ns-resize
```

Known risk, from the project's own gotcha list: an SVG at natural width can
stretch `.cm-content` and break line wrapping. `overflow: hidden` plus
`width: 100%` on the frame should contain it; if not, apply
`contain: inline-size` to `.cm-line` the way tables do.

## Testing

Vitest against the pure functions: `computeFit` (wide, tall and small diagrams,
the cap at 1), `clampPan` (centering, and the clamp at each edge), `zoomAt` (the
invariant that the point under the cursor stays put), `wheelIntent` (fit →
pass-through, zoomed → pan, edge plus direction → pass-through) and
`autoHeight`. Plus a remap test for `mermaid-state.ts` modeled on
`table-state.test.ts`. Navigation itself is verified by hand in `npm run dev`.

## Implementation Order

1. `mermaid-viewport.ts` — pure math and its tests, no DOM
2. `mermaid-state.ts` and its remap test; register the field in `setup.ts`
3. DOM controller: frame, canvas, restore from state, debounced commit
4. Zoom: pinch, `Cmd`+wheel, the `±` buttons
5. Pan: left-drag, then `wheel` with the pass-through rule
6. Fit: the `⤢` button, double click, the percentage readout
7. The resize handle and auto height
8. CSS polish; check both themes; confirm line wrapping still works
9. Update `preview/CLAUDE.md` and the gotchas in the root `CLAUDE.md`
