/**
 * Pan/zoom geometry for rendered mermaid diagrams.
 *
 * Everything above the "DOM controller" divider is pure: plain records in,
 * plain records out, no DOM and no CodeMirror. That is what the unit tests
 * exercise.
 *
 * Coordinate model: the canvas is the diagram at its natural size, positioned
 * with `translate(tx, ty) scale(scale)` and `transform-origin: 0 0`. A content
 * point (cx, cy) therefore lands at (tx + cx * scale, ty + cy * scale) in frame
 * coordinates.
 */

// -- Types --

export interface Size {
  width: number;
  height: number;
}

export interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

export interface Point {
  x: number;
  y: number;
}

export type WheelIntent = 'zoom' | 'pan' | 'passthrough';

interface WheelLike {
  ctrlKey: boolean;
  metaKey: boolean;
  deltaX: number;
  deltaY: number;
}

// -- Constants --

export const MAX_SCALE = 8;
export const MIN_FRAME_HEIGHT = 60;

/** Zoom floor under normal circumstances; a diagram whose fit is smaller wins. */
const SCALE_FLOOR = 0.1;

/** Scale comparisons are float-tolerant. */
const SCALE_EPSILON = 1e-4;

/** A pan honored by less than this many pixels counts as no movement at all. */
const PAN_EPSILON = 0.01;

// -- Pure geometry --

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function usable(content: Size, frame: Size): boolean {
  return content.width > 0 && content.height > 0 && frame.width > 0 && frame.height > 0;
}

/** Largest scale at which the whole diagram is visible. Never upscales. */
export function fitScale(content: Size, frame: Size): number {
  if (!usable(content, frame)) return 1;
  return Math.min(1, frame.width / content.width, frame.height / content.height);
}

export function minScale(content: Size, frame: Size): number {
  return Math.min(SCALE_FLOOR, fitScale(content, frame));
}

/** The "full view": fit scale, centered in the frame. */
export function computeFit(content: Size, frame: Size): ViewState {
  const scale = fitScale(content, frame);
  return {
    scale,
    tx: (frame.width - content.width * scale) / 2,
    ty: (frame.height - content.height * scale) / 2,
  };
}

/**
 * Frame height that shows the diagram at its width-constrained size, capped so
 * a tall diagram never swallows the document.
 */
export function autoHeight(content: Size, frameWidth: number, maxHeight: number): number {
  if (content.width <= 0 || content.height <= 0 || frameWidth <= 0) {
    return MIN_FRAME_HEIGHT;
  }
  const widthScale = Math.min(1, frameWidth / content.width);
  return clamp(content.height * widthScale, MIN_FRAME_HEIGHT, Math.max(MIN_FRAME_HEIGHT, maxHeight));
}

/**
 * Keep the diagram honest: center it on any axis where it is smaller than the
 * frame, otherwise forbid its edges from moving inside the frame.
 */
export function clampPan(view: ViewState, content: Size, frame: Size): ViewState {
  const scaledW = content.width * view.scale;
  const scaledH = content.height * view.scale;

  const tx =
    scaledW <= frame.width
      ? (frame.width - scaledW) / 2
      : clamp(view.tx, frame.width - scaledW, 0);

  const ty =
    scaledH <= frame.height
      ? (frame.height - scaledH) / 2
      : clamp(view.ty, frame.height - scaledH, 0);

  return { scale: view.scale, tx, ty };
}

/**
 * Pan by a wheel/drag delta. Deltas follow the scroll convention: a positive
 * delta moves the content in the negative direction, as if scrolling down.
 */
export function panBy(
  view: ViewState,
  deltaX: number,
  deltaY: number,
  content: Size,
  frame: Size
): ViewState {
  return clampPan(
    { scale: view.scale, tx: view.tx - deltaX, ty: view.ty - deltaY },
    content,
    frame
  );
}

/** Zoom by `factor`, keeping the content point under `point` fixed. */
export function zoomAt(
  view: ViewState,
  factor: number,
  point: Point,
  content: Size,
  frame: Size
): ViewState {
  const scale = clamp(view.scale * factor, minScale(content, frame), MAX_SCALE);

  // Content coordinate currently under the pointer.
  const cx = (point.x - view.tx) / view.scale;
  const cy = (point.y - view.ty) / view.scale;

  return clampPan(
    { scale, tx: point.x - cx * scale, ty: point.y - cy * scale },
    content,
    frame
  );
}

/**
 * True when the diagram is showing at (or beyond) its full view — meaning there
 * is nothing to pan, so wheel events belong to the document.
 */
export function isAtFit(view: ViewState, content: Size, frame: Size): boolean {
  return view.scale <= fitScale(content, frame) + SCALE_EPSILON;
}

/**
 * Decide who owns a wheel event. `passthrough` is the important verdict: it is
 * what keeps a diagram from becoming a scroll trap in a long document.
 */
export function wheelIntent(
  event: WheelLike,
  view: ViewState,
  content: Size,
  frame: Size
): WheelIntent {
  if (event.ctrlKey || event.metaKey) return 'zoom';
  if (isAtFit(view, content, frame)) return 'passthrough';

  const next = panBy(view, event.deltaX, event.deltaY, content, frame);
  const moved =
    Math.abs(next.tx - view.tx) > PAN_EPSILON || Math.abs(next.ty - view.ty) > PAN_EPSILON;

  return moved ? 'pan' : 'passthrough';
}

/** Wheel delta → zoom factor, damped so a mouse wheel doesn't jump octaves. */
export function wheelZoomFactor(deltaY: number): number {
  return Math.exp(-clamp(deltaY, -50, 50) * 0.01);
}

// ---------------------------------------------------------------------------
// DOM controller
// ---------------------------------------------------------------------------

/** Fraction of the window height an auto-sized frame may occupy. */
const AUTO_HEIGHT_FRACTION = 0.6;
/** Fraction of the window height a manually resized frame may occupy. */
const MANUAL_HEIGHT_FRACTION = 0.95;

const BUTTON_ZOOM_STEP = 1.4;
const DOUBLE_CLICK_ZOOM = 2;
const COMMIT_DEBOUNCE_MS = 150;

export interface ViewportInit {
  scale: number;
  tx: number;
  ty: number;
  frameHeight: number | null;
}

export interface ViewportController {
  dom: HTMLElement;
  destroy(): void;
}

function maxAutoHeight(): number {
  return Math.max(MIN_FRAME_HEIGHT, window.innerHeight * AUTO_HEIGHT_FRACTION);
}

function maxManualHeight(): number {
  return Math.max(MIN_FRAME_HEIGHT, window.innerHeight * MANUAL_HEIGHT_FRACTION);
}

/**
 * Natural diagram size. The viewBox is authoritative — `clientWidth` has
 * already been distorted by mermaid's own `max-width` style.
 */
function readContentSize(svg: SVGSVGElement): Size {
  const box = svg.viewBox?.baseVal;
  if (box && box.width > 0 && box.height > 0) {
    return { width: box.width, height: box.height };
  }

  const rawW = svg.getAttribute('width') ?? '';
  const rawH = svg.getAttribute('height') ?? '';
  if (!rawW.includes('%') && !rawH.includes('%')) {
    const w = parseFloat(rawW);
    const h = parseFloat(rawH);
    if (w > 0 && h > 0) return { width: w, height: h };
  }

  try {
    const bbox = svg.getBBox();
    if (bbox.width > 0 && bbox.height > 0) {
      return { width: bbox.width, height: bbox.height };
    }
  } catch {
    // getBBox throws when the element is not yet rendered
  }

  return { width: 0, height: 0 };
}

function makeButton(label: string, title: string, className: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = className;
  btn.textContent = label;
  btn.title = title;
  btn.tabIndex = -1;
  return btn;
}

/**
 * Builds the pan/zoom frame around a rendered mermaid SVG.
 *
 * Interaction writes `transform` straight to the DOM; `onCommit` is called on a
 * trailing debounce so the CodeMirror state field only sees settled values.
 */
export function createViewport(
  svgMarkup: string,
  initial: ViewportInit | null,
  onCommit: (state: ViewportInit) => void
): ViewportController {
  const dom = document.createElement('div');
  dom.className = 'cm-md-mermaid-frame';

  const viewport = document.createElement('div');
  viewport.className = 'cm-md-mermaid-viewport';

  const canvas = document.createElement('div');
  canvas.className = 'cm-md-mermaid-canvas';
  canvas.innerHTML = svgMarkup;

  viewport.appendChild(canvas);
  dom.appendChild(viewport);

  // -- Controls --

  const controls = document.createElement('div');
  controls.className = 'cm-md-mermaid-controls';
  const zoomOutBtn = makeButton('−', 'Zoom out', 'cm-md-mermaid-btn');
  const readout = document.createElement('span');
  readout.className = 'cm-md-mermaid-zoom-readout';
  const zoomInBtn = makeButton('+', 'Zoom in', 'cm-md-mermaid-btn');
  const fitBtn = makeButton('⤢', 'Fit diagram', 'cm-md-mermaid-btn');
  controls.append(zoomOutBtn, readout, zoomInBtn, fitBtn);
  dom.appendChild(controls);

  const handle = document.createElement('div');
  handle.className = 'cm-md-mermaid-resize';
  handle.title = 'Drag to resize, double-click to reset';
  dom.appendChild(handle);

  // -- Mutable state --

  const svg = canvas.querySelector('svg');
  let content: Size = { width: 0, height: 0 };
  let frame: Size = { width: 0, height: 0 };
  let view: ViewState = { scale: 1, tx: 0, ty: 0 };
  let frameHeight: number | null = initial?.frameHeight ?? null;
  let restored: ViewState | null = initial ? { scale: initial.scale, tx: initial.tx, ty: initial.ty } : null;
  let measured = false;
  let destroyed = false;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;
  let releaseDrag: (() => void) | null = null;

  if (svg instanceof SVGSVGElement) {
    content = readContentSize(svg);
    // Natural size, so the zoom math and the rendered pixels agree.
    svg.style.maxWidth = 'none';
    svg.style.display = 'block';
    if (content.width > 0) {
      svg.setAttribute('width', String(content.width));
      svg.setAttribute('height', String(content.height));
    }
  }

  function apply(): void {
    canvas.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;
    readout.textContent = `${Math.round(view.scale * 100)}%`;
    dom.classList.toggle('is-zoomed', !isAtFit(view, content, frame));
  }

  function commit(): void {
    if (commitTimer) clearTimeout(commitTimer);
    commitTimer = setTimeout(() => {
      commitTimer = null;
      if (destroyed) return;
      onCommit({ scale: view.scale, tx: view.tx, ty: view.ty, frameHeight });
    }, COMMIT_DEBOUNCE_MS);
  }

  function setFrameHeight(px: number | null): void {
    frameHeight = px;
    const height =
      px !== null
        ? clamp(px, MIN_FRAME_HEIGHT, maxManualHeight())
        : autoHeight(content, frame.width, maxAutoHeight());
    viewport.style.height = `${Math.round(height)}px`;
    frame = { width: frame.width, height };
  }

  function fit(): void {
    view = computeFit(content, frame);
    apply();
    commit();
  }

  function zoom(factor: number, point: Point): void {
    view = zoomAt(view, factor, point, content, frame);
    apply();
    commit();
  }

  function frameCenter(): Point {
    return { x: frame.width / 2, y: frame.height / 2 };
  }

  function pointerIn(event: MouseEvent): Point {
    const rect = viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Re-measure after insertion or a width change. The frame width only becomes
   * known once the element is in the document, so the first pass is what
   * establishes the initial view.
   */
  function remeasure(width: number): void {
    frame = { width, height: frame.height };
    setFrameHeight(frameHeight);

    if (!measured) {
      measured = true;
      view = restored ? clampPan(restored, content, frame) : computeFit(content, frame);
      restored = null;
    } else if (isAtFit(view, content, frame)) {
      // Never zoomed, or zoomed back out — track the new fit.
      view = computeFit(content, frame);
    } else {
      view = clampPan(view, content, frame);
    }
    apply();
  }

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const width = entry.contentRect.width;
      if (width <= 0) continue;
      if (measured && Math.abs(width - frame.width) < 0.5) continue;
      remeasure(width);
    }
  });
  observer.observe(dom);

  // -- Wheel: zoom, pan, or hand back to the document --

  function onWheel(event: WheelEvent): void {
    if (!measured) return;
    const intent = wheelIntent(event, view, content, frame);
    if (intent === 'passthrough') return; // no preventDefault → the document scrolls

    event.preventDefault();
    event.stopPropagation();

    if (intent === 'zoom') {
      zoom(wheelZoomFactor(event.deltaY), pointerIn(event));
    } else {
      view = panBy(view, event.deltaX, event.deltaY, content, frame);
      apply();
      commit();
    }
  }
  viewport.addEventListener('wheel', onWheel, { passive: false });

  // -- Drag to pan --

  function onMouseDown(event: MouseEvent): void {
    if (event.button !== 0 || !measured) return;
    event.preventDefault();
    event.stopPropagation();

    let lastX = event.clientX;
    let lastY = event.clientY;
    dom.classList.add('is-grabbing');

    const onMove = (move: MouseEvent) => {
      // panBy follows the scroll convention, so a rightward drag is a negative delta
      view = panBy(view, lastX - move.clientX, lastY - move.clientY, content, frame);
      lastX = move.clientX;
      lastY = move.clientY;
      apply();
    };

    const onUp = () => {
      release();
      commit();
    };

    const release = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dom.classList.remove('is-grabbing');
      releaseDrag = null;
    };

    releaseDrag = release;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  viewport.addEventListener('mousedown', onMouseDown);

  // -- Double click: fit, or zoom in when already fitted --

  function onDoubleClick(event: MouseEvent): void {
    if (!measured) return;
    event.preventDefault();
    event.stopPropagation();
    if (isAtFit(view, content, frame)) {
      zoom(DOUBLE_CLICK_ZOOM, pointerIn(event));
    } else {
      fit();
    }
  }
  viewport.addEventListener('dblclick', onDoubleClick);

  // -- Control buttons (mousedown, to fire before CodeMirror sees the event) --

  function bindButton(btn: HTMLElement, action: () => void): () => void {
    const listener = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (measured) action();
    };
    btn.addEventListener('mousedown', listener);
    return () => btn.removeEventListener('mousedown', listener);
  }

  const unbind = [
    bindButton(zoomInBtn, () => zoom(BUTTON_ZOOM_STEP, frameCenter())),
    bindButton(zoomOutBtn, () => zoom(1 / BUTTON_ZOOM_STEP, frameCenter())),
    bindButton(fitBtn, () => fit()),
  ];

  // -- Resize handle --

  function onHandleDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const startHeight = frame.height;

    const onMove = (move: MouseEvent) => {
      setFrameHeight(startHeight + (move.clientY - startY));
      view = isAtFit(view, content, frame)
        ? computeFit(content, frame)
        : clampPan(view, content, frame);
      apply();
    };

    const onUp = () => {
      release();
      commit();
    };

    const release = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dom.classList.remove('is-resizing');
      releaseDrag = null;
    };

    releaseDrag = release;
    dom.classList.add('is-resizing');
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }
  handle.addEventListener('mousedown', onHandleDown);

  function onHandleDoubleClick(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
    setFrameHeight(null);
    view = computeFit(content, frame);
    apply();
    commit();
  }
  handle.addEventListener('dblclick', onHandleDoubleClick);

  apply();

  return {
    dom,
    destroy() {
      destroyed = true;
      if (commitTimer) clearTimeout(commitTimer);
      releaseDrag?.();
      observer.disconnect();
      viewport.removeEventListener('wheel', onWheel);
      viewport.removeEventListener('mousedown', onMouseDown);
      viewport.removeEventListener('dblclick', onDoubleClick);
      handle.removeEventListener('mousedown', onHandleDown);
      handle.removeEventListener('dblclick', onHandleDoubleClick);
      for (const off of unbind) off();
    },
  };
}
