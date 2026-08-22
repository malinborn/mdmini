# Deploying md-mini.com

Static site lives in `docs/`, served by nginx from `/var/www/md-mini.com`.
Pushes to `main` touching `docs/**` auto-deploy via `.github/workflows/deploy-site.yml`.

## One-time server setup

1. **DNS** — create records pointing at the server:
   - `A md-mini.com → <server IP>`
   - `A www.md-mini.com → <server IP>`
   (plus AAAA if the server has IPv6)

2. **Web root + deploy user access**
   ```bash
   sudo mkdir -p /var/www/md-mini.com
   sudo chown <deploy-user>:<deploy-user> /var/www/md-mini.com
   ```

3. **Bootstrap nginx (port 80, needed for the certbot challenge)** — run from the repo root:
   ```bash
   sudo cp deploy/nginx/md-mini.com-bootstrap.conf /etc/nginx/sites-available/md-mini.com.conf
   sudo ln -s /etc/nginx/sites-available/md-mini.com.conf /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```

4. **Install certbot** (skip if already installed)
   ```bash
   sudo apt install certbot python3-certbot-nginx
   ```

5. **Certificate**
   ```bash
   sudo certbot certonly --nginx -d md-mini.com -d www.md-mini.com --deploy-hook 'systemctl reload nginx'
   ```

   Before applying the final config, confirm certbot's nginx plugin created its snippets:
   ```bash
   ls /etc/letsencrypt/options-ssl-nginx.conf /etc/letsencrypt/ssl-dhparams.pem
   ```

6. **Final config** — run from the repo root:
   ```bash
   sudo cp deploy/nginx/md-mini.com.conf /etc/nginx/sites-available/md-mini.com.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```

7. **GitHub secrets** (repo → Settings → Secrets → Actions):
   - `DEPLOY_SSH_KEY` — private key of a dedicated deploy keypair; public half in the deploy user's `~/.ssh/authorized_keys`
   - `DEPLOY_HOST` — server hostname or IP
   - `DEPLOY_USER` — deploy username

8. **First deploy** — push to main (or run the workflow manually via workflow_dispatch).

## Post-go-live checks

```bash
curl -sI http://md-mini.com | head -3          # 301 → https://md-mini.com/
curl -sI https://www.md-mini.com | head -3     # 301 → https://md-mini.com/
curl -sI https://md-mini.com | grep -i strict  # HSTS present
curl -s https://md-mini.com/sitemap.xml | head -3
```

## Google Search Console

1. Add property `md-mini.com` (Domain type), verify via DNS TXT record.
2. Submit `https://md-mini.com/sitemap.xml`.
3. Old github.io page keeps `rel=canonical` → md-mini.com; expect Google to
   re-attribute within a few weeks.
