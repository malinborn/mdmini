import { Decoration, WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';
import type { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { cursorInRange } from './utils';

// -- Types --

interface MermaidCacheEntry {
  svg: string | null;
  error: string | null;
}

// -- StateEffect dispatched after a render completes --

export const mermaidRendered = StateEffect.define<null>();

// -- Lazy loader --

type MermaidAPI = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, definition: string) => Promise<{ svg: string }>;
};

let mermaidModule: MermaidAPI | null = null;
let mermaidLoading: Promise<MermaidAPI> | null = null;

function currentTheme(): 'default' | 'dark' {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'default';
}

async function loadMermaid(): Promise<MermaidAPI> {
  if (mermaidModule) return mermaidModule;
  if (mermaidLoading) return mermaidLoading;

  mermaidLoading = import('mermaid').then((m) => {
    const api = m.default;
    (api.initialize as (config: Record<string, unknown>) => void)({
      startOnLoad: false,
      theme: currentTheme(),
      suppressErrors: true,
    });
    mermaidModule = api as unknown as MermaidAPI;
    return mermaidModule;
  });

  return mermaidLoading;
}

// -- Render cache (content-addressed) --

const cache = new Map<string, MermaidCacheEntry>();
const MAX_CACHE = 50;

export function getCached(source: string): MermaidCacheEntry | undefined {
  const entry = cache.get(source);
  if (entry !== undefined) {
    // Promote to most-recently-used by re-inserting at tail
    cache.delete(source);
    cache.set(source, entry);
  }
  return entry;
}

function setCache(source: string, entry: MermaidCacheEntry): void {
  if (cache.size >= MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(source, entry);
}

// -- Render queue (sequential, mermaid can't render concurrently) --

let renderCounter = 0;
let rendering = false;
const queue: Array<{ source: string; view: EditorView; resolve: () => void }> = [];

async function processQueue(): Promise<void> {
  if (rendering) return;
  rendering = true;

  while (queue.length > 0) {
    const job = queue.shift()!;
    if (cache.has(job.source) && cache.get(job.source)!.svg !== null) {
      job.resolve();
      continue;
    }

    try {
      const api = await loadMermaid();
      const id = `mermaid-render-${renderCounter++}`;
      const { svg } = await api.render(id, job.source);
      setCache(job.source, { svg, error: null });
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      const prev = cache.get(job.source);
      setCache(job.source, {
        svg: prev?.svg ?? null,
        error: errorMsg,
      });
    }

    try {
      job.view.dispatch({ effects: mermaidRendered.of(null) });
    } catch {
      // View may be destroyed
    }
    job.resolve();
  }

  rendering = false;
}

// -- Debounced render request --

const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 300;

export function requestRender(source: string, view: EditorView): void {
  const existing = cache.get(source);
  if (existing?.svg) return;

  const existing_timer = debounceTimers.get(source);
  if (existing_timer) clearTimeout(existing_timer);

  debounceTimers.set(
    source,
    setTimeout(() => {
      debounceTimers.delete(source);
      void new Promise<void>((resolve) => {
        queue.push({ source, view, resolve });
        processQueue();
      });
    }, DEBOUNCE_MS)
  );
}

// -- Theme change: clear cache and re-render --

export function reinitializeTheme(): void {
  if (!mermaidModule) return;
  mermaidModule.initialize({
    startOnLoad: false,
    theme: currentTheme(),
    suppressErrors: true,
  });
  cache.clear();
}

// -- Widget --

class MermaidWidget extends WidgetType {
  constructor(
    private source: string,
    private svg: string | null,
    private error: string | null
  ) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return (
      this.source === other.source &&
      this.svg === other.svg &&
      this.error === other.error
    );
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-md-mermaid-container';

    if (this.svg) {
      const svgWrapper = document.createElement('div');
      svgWrapper.className = 'cm-md-mermaid-svg';
      svgWrapper.innerHTML = this.svg;
      container.appendChild(svgWrapper);
    }

    if (this.error) {
      const errorBar = document.createElement('div');
      errorBar.className = 'cm-md-mermaid-error';
      const msg = this.error.length > 150 ? this.error.slice(0, 147) + '...' : this.error;
      errorBar.textContent = `⚠ ${msg}`;
      container.appendChild(errorBar);
    }

    if (!this.svg && !this.error) {
      const placeholder = document.createElement('div');
      placeholder.className = 'cm-md-mermaid-placeholder';
      placeholder.textContent = 'Rendering diagram...';
      container.appendChild(placeholder);
    }

    return container;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

// -- Decorator function (called from plugin.ts) --

export function decorateMermaidBlock(
  view: EditorView,
  node: SyntaxNode,
  builder: RangeSetBuilder<Decoration>
): void {
  if (cursorInRange(view, node.from, node.to, true)) return;

  const doc = view.state.doc;
  const startLine = doc.lineAt(node.from);
  const endLine = doc.lineAt(node.to);

  const firstContentLineNum = startLine.number + 1;
  const lastContentLineNum = endLine.number - 1;
  const hasContent = firstContentLineNum <= lastContentLineNum;

  if (!hasContent) return;

  const source = doc.sliceString(
    doc.line(firstContentLineNum).from,
    doc.line(lastContentLineNum).to
  );

  if (!source.trim()) return;

  const cached = getCached(source);
  const svg = cached?.svg ?? null;
  const error = cached?.error ?? null;

  if (!cached || !cached.svg) {
    requestRender(source, view);
  }

  // Hide all lines of the fenced block, replace with widget on first line
  for (let i = startLine.number; i <= endLine.number; i++) {
    const line = doc.line(i);

    if (i === startLine.number) {
      // First line hosts the widget — do NOT hide it (no height:0 class)
      builder.add(
        line.from,
        line.to,
        Decoration.replace({
          widget: new MermaidWidget(source, svg, error),
        })
      );
    } else {
      builder.add(
        line.from,
        line.from,
        Decoration.line({ class: 'cm-md-mermaid-line-hidden' })
      );
      if (line.length > 0) {
        builder.add(line.from, line.to, Decoration.replace({}));
      }
    }
  }
}
