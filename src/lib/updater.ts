/**
 * Update checker — compares the running version with the latest GitHub release.
 * Checks 15s after launch and then hourly.
 *
 * Rendering is the caller's problem: it hands in a callback and decides what the
 * notification looks like. This keeps the toast store owned by the component
 * tree instead of becoming a module singleton.
 */

const GITHUB_REPO = 'malinborn/mdmini';
const CHECK_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour
const FIRST_CHECK_DELAY = 15_000;

export type UpdateHandler = (latest: string, current: string) => void;

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

export async function checkForUpdates(onUpdate: UpdateHandler): Promise<void> {
  try {
    const current = await getCurrentVersion();

    const res = await fetch(CHECK_URL, {
      headers: { Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;

    const data = await res.json();
    const latest = data.tag_name as string;

    if (!latest || !isNewer(latest, current)) return;

    onUpdate(latest, current);
  } catch {
    // Network error, repo not found — silently ignore
  }
}

/** Start periodic update checks. Returns a stop function. */
export function startUpdateChecker(onUpdate: UpdateHandler): () => void {
  const initialTimer = setTimeout(() => checkForUpdates(onUpdate), FIRST_CHECK_DELAY);
  const intervalTimer = setInterval(() => checkForUpdates(onUpdate), CHECK_INTERVAL);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(intervalTimer);
  };
}
