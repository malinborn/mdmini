/**
 * Pure decision logic for the "Esc hides the AI highlight" hint. No runes here —
 * this is plain, easily testable TypeScript. Orchestration (timers, localStorage,
 * DOM) lives in App.svelte; see ai-highlight.ts for the presence notifier that
 * feeds `visibleSince` into this module.
 */

/** How long a highlight must stay continuously visible before the hint reappears. */
export const HINT_REVIVE_MS = 2 * 60 * 60 * 1000;

/**
 * True when the hint should be shown: a highlight is currently visible, and
 * either the user has never seen the hint before, or this highlight has been
 * visible for at least HINT_REVIVE_MS (they clearly missed it last time).
 */
export function shouldShowHint(args: {
  seenBefore: boolean;
  visibleSince: number | null;
  now: number;
}): boolean {
  const { seenBefore, visibleSince, now } = args;
  if (visibleSince === null) return false;
  return !seenBefore || now - visibleSince >= HINT_REVIVE_MS;
}

/**
 * Milliseconds until this highlight's visibility crosses the HINT_REVIVE_MS
 * mark, clamped to 0 if that mark has already passed. Used to schedule a
 * single setTimeout instead of polling.
 */
export function nextCheckDelay(args: { visibleSince: number; now: number }): number {
  const { visibleSince, now } = args;
  const elapsed = now - visibleSince;
  return Math.max(0, HINT_REVIVE_MS - elapsed);
}
