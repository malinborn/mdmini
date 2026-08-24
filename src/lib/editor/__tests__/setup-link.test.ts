// @vitest-environment jsdom
// The rest of the suite runs in vitest's default node environment (no DOM
// needed). This file exercises `window.open`, so it opts into jsdom on its own
// rather than paying the DOM-setup cost project-wide.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openExternalUrl } from '../setup';

describe('openExternalUrl', () => {
  beforeEach(() => {
    vi.stubGlobal('open', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to window.open when the Tauri shell plugin is unavailable', async () => {
    await openExternalUrl('https://example.com');
    expect(window.open).toHaveBeenCalledWith('https://example.com', '_blank');
  });
});
