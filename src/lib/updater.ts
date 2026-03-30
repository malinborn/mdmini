/**
 * Simple update checker — compares current version with latest GitHub release.
 * Shows an in-app banner if a newer version exists.
 */

const GITHUB_REPO = 'malinborn/mdmini';
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

function showUpdateBanner(latest: string, current: string): void {
  // Remove existing banner if any
  document.querySelector('.md-update-banner')?.remove();

  const brewCmd = 'brew upgrade --cask md-mini';

  const banner = document.createElement('div');
  banner.className = 'md-update-banner';
  banner.innerHTML = `
    <div class="md-update-content">
      <span class="md-update-text">
        <strong>md-mini ${latest}</strong> available <span class="md-update-dim">(you have v${current})</span>
      </span>
      <code class="md-update-cmd" title="Click to copy">${brewCmd}</code>
      <button class="md-update-close" title="Dismiss">✕</button>
    </div>
  `;

  const cmdEl = banner.querySelector('.md-update-cmd') as HTMLElement;
  cmdEl.addEventListener('click', () => {
    navigator.clipboard.writeText(brewCmd);
    cmdEl.textContent = 'Copied!';
    setTimeout(() => { cmdEl.textContent = brewCmd; }, 1500);
  });

  const closeBtn = banner.querySelector('.md-update-close') as HTMLElement;
  closeBtn.addEventListener('click', () => banner.remove());

  document.body.appendChild(banner);
}

export async function checkForUpdates(): Promise<void> {
  try {
    const current = await getCurrentVersion();

    const res = await fetch(CHECK_URL, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return;

    const data = await res.json();
    const latest = data.tag_name as string;

    if (!latest || !isNewer(latest, current)) return;

    showUpdateBanner(latest, current);
  } catch {
    // Network error, repo not found — silently ignore
  }
}
