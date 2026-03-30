/**
 * Simple update checker — compares current version with latest GitHub release.
 * Shows a non-intrusive notification if a newer version exists.
 * No Tauri updater plugin needed — just fetch + compare.
 */

// TODO: Replace with your actual GitHub repo when published
const GITHUB_REPO = 'maximkovalevskij/md-mini';
const CHECK_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

async function getCurrentVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}

function isNewer(latest: string, current: string): boolean {
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
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;

    const data = await res.json();
    const latest = data.tag_name as string; // e.g. "v0.2.0"

    if (!latest || !isNewer(latest, current)) return;

    // Show non-intrusive notification
    const { ask } = await import('@tauri-apps/plugin-dialog');
    const shouldUpdate = await ask(
      `md-mini ${latest} is available (you have v${current}).\n\nTo update, run in terminal:\nbrew upgrade --cask md-mini`,
      { title: 'Update Available', kind: 'info' }
    );

    if (shouldUpdate) {
      // Copy the command to clipboard for convenience
      await navigator.clipboard.writeText('brew upgrade --cask md-mini');
    }
  } catch {
    // Network error, repo not found, etc. — silently ignore
  }
}
