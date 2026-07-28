/**
 * Update checker — compares the running version with the latest GitHub release.
 * Checks 15s after launch and then hourly.
 *
 * Only **one** window polls. Every window used to run its own timer, which meant
 * one request per window per hour for a single answer, and a notice that had to be
 * dismissed separately in each window. The claim and the dismissal are held in
 * Rust (`src-tauri/src/updater.rs`); a find is reported there and broadcast to
 * every window from one place.
 */

import { invoke } from '@tauri-apps/api/core';

const GITHUB_REPO = 'malinborn/mdmini';
const CHECK_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const FIRST_CHECK_DELAY = 15_000;

async function getCurrentVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

export function isNewer(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [la, lb, lc] = parse(latest);
  const [ca, cb, cc] = parse(current);
  if (la !== ca) return la > ca;
  if (lb !== cb) return lb > cb;
  return lc > cc;
}

export async function checkForUpdates(): Promise<void> {
  try {
    const current = await getCurrentVersion();

    const res = await fetch(CHECK_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;

    const data = await res.json();
    const latest = data.tag_name as string;

    if (!latest || !isNewer(latest, current)) return;

    // Rust decides whether this is worth showing — it remembers dismissals and
    // suppresses the repeat report every subsequent hour.
    await invoke('report_update', { latest, current });
  } catch {
    // Network error, repo not found — silently ignore
  }
}

/**
 * Start periodic checks, but only in the window that wins the claim. Returns a
 * stop function; it is a no-op in windows that did not win.
 */
export async function startUpdateChecker(): Promise<() => void> {
  const isChecker = await invoke<boolean>('claim_update_checker').catch(() => false);
  if (!isChecker) return () => {};

  const initialTimer = setTimeout(() => void checkForUpdates(), FIRST_CHECK_DELAY);
  const intervalTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
