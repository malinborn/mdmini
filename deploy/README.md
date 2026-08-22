# Deploying md-mini.com

Static site lives in `docs/`, served by Caddy from `/var/www/md-mini.com`.
Pushes to `main` touching `docs/**` auto-deploy via `.github/workflows/deploy-site.yml`.

Caddy terminates TLS and **issues and renews the certificate by itself** — there
is no certbot, no renewal cron job and no deploy hook to maintain. It also
redirects HTTP to HTTPS automatically, so neither the config nor this guide
mentions port 80 beyond opening it in the firewall (ACME needs it).

## One-time server setup

1. **DNS** — create records pointing at the server:
   - `A md-mini.com → 147.45.146.94`
   - `A www.md-mini.com → 147.45.146.94`
   (plus AAAA if the server has IPv6)

   Both names must resolve *before* Caddy first serves them: the certificate is
   obtained over an HTTP-01 challenge on the live hostname.

2. **Caddy** — must already be installed and running:
   ```bash
   caddy version
   systemctl is-active caddy
   ```
   If it is missing, install it from the official Caddy apt repo first;
   `provision.sh` refuses to run without it and prints the commands.

3. **Run the provisioning script** — copy the repo (or just `deploy/`) to the
   server and run as root:
   ```bash
   sudo bash deploy/provision.sh
   ```
   It is idempotent. It creates the `deploy-mdmini` user (no sudo, no password),
   prepares `/var/www/md-mini.com` with a placeholder `index.html`, generates the
   deploy SSH keypair, opens 80/443 in ufw, installs the site config, validates
   and reloads Caddy, then prints the private key and the `gh secret set` hint.

   <details>
   <summary>Manual equivalent</summary>

   ```bash
   # web root, owned by the deploy user, readable by the caddy user
   sudo mkdir -p /var/www/md-mini.com
   sudo chown -R deploy-mdmini:deploy-mdmini /var/www/md-mini.com
   sudo chmod -R a+rX /var/www/md-mini.com

   # site config as a fragment — never overwrite an existing /etc/caddy/Caddyfile
   sudo mkdir -p /etc/caddy/Caddyfile.d
   sudo cp deploy/caddy/Caddyfile /etc/caddy/Caddyfile.d/md-mini.com.caddy

   # wire it in, once
   grep -qxF 'import Caddyfile.d/*.caddy' /etc/caddy/Caddyfile \
     || echo 'import Caddyfile.d/*.caddy' | sudo tee -a /etc/caddy/Caddyfile

   sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy

   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   ```

   The web root must stay world-readable: Caddy runs as the `caddy` system user,
   not as `deploy-mdmini`. The CI rsync uses `-a`, so it reproduces the repo's
   `644`/`755` modes and keeps that property on every deploy.
   </details>

4. **GitHub secrets** (repo → Settings → Secrets and variables → Actions):

   | Secret | Value |
   |---|---|
   | `DEPLOY_SSH_KEY` | private half of the deploy keypair (`/home/deploy-mdmini/.ssh/id_ed25519`); the public half is already in that user's `authorized_keys` |
   | `DEPLOY_HOST` | `147.45.146.94` |
   | `DEPLOY_USER` | `deploy-mdmini` |

   Set the key without pasting it anywhere:
   ```bash
   gh secret set DEPLOY_SSH_KEY --repo malinborn/mdmini < /home/deploy-mdmini/.ssh/id_ed25519
   ```

5. **First deploy** — push to main (or run the workflow manually via
   workflow_dispatch). The first HTTPS request afterwards triggers certificate
   issuance; give it a few seconds.

## Post-go-live checks

```bash
curl -sI http://md-mini.com | head -3          # 308 → https://md-mini.com/ (Caddy's auto redirect)
curl -sI https://www.md-mini.com | head -3     # 301 → https://md-mini.com/
curl -sI https://md-mini.com | grep -i strict  # HSTS present
curl -sI https://md-mini.com/logo.png | grep -i cache  # public, max-age=2592000
curl -s https://md-mini.com/sitemap.xml | head -3
```

If the first check returns `200` and the Caddy welcome page instead of a
redirect, the Caddy package's default `:80` site block is still present in
`/etc/caddy/Caddyfile`. A catch-all site on the HTTP port suppresses Caddy's
automatic HTTP→HTTPS redirects for every host. Remove that block, then
`caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile && systemctl reload caddy`.
HTTPS and certificate issuance work either way; only the plain-HTTP redirect
is affected. `provision.sh` warns about this.

Certificate state, if something looks off:

```bash
sudo journalctl -u caddy -n 50 --no-pager
sudo ls /var/lib/caddy/.local/share/caddy/certificates/*/md-mini.com/
```

## Google Search Console

1. Add property `md-mini.com` (Domain type), verify via DNS TXT record.
2. Submit `https://md-mini.com/sitemap.xml`.
3. Old github.io page keeps `rel=canonical` → md-mini.com; expect Google to
   re-attribute within a few weeks.
