#!/usr/bin/env bash
# Provision md-mini.com on a fresh Ubuntu server. Run as root:
#
#   bash provision.sh
#
# Idempotent — safe to re-run. Creates the deploy user and its SSH key,
# installs nginx + certbot, issues the TLS certificate, and applies the
# production vhost. Prints the deploy private key at the end.

set -euo pipefail

DOMAIN="md-mini.com"
DEPLOY_USER="deploy-mdmini"
WEBROOT="/var/www/${DOMAIN}"
KEY_PATH="/home/${DEPLOY_USER}/.ssh/id_ed25519"
NGINX_CONF="/etc/nginx/sites-available/${DOMAIN}.conf"
CERT_EMAIL="m.kovalevskiy@dodobrands.io"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo bash provision.sh)" >&2
  exit 1
fi

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }

step "Installing nginx, certbot, rsync"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx certbot python3-certbot-nginx rsync

step "Creating deploy user ${DEPLOY_USER}"
if id "$DEPLOY_USER" &>/dev/null; then
  echo "user already exists — skipping"
else
  # No sudo group, no password login: this account only receives rsync over SSH.
  adduser --disabled-password --gecos "md-mini site deploy" "$DEPLOY_USER"
fi

step "Preparing web root ${WEBROOT}"
mkdir -p "$WEBROOT"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$WEBROOT"
chmod 755 "$WEBROOT"

# Placeholder so the vhost has something to serve before the first CI deploy.
if [[ ! -f "${WEBROOT}/index.html" ]]; then
  cat > "${WEBROOT}/index.html" <<'PLACEHOLDER'
<!doctype html>
<meta charset="utf-8">
<title>md-mini.com</title>
<p>Coming soon.</p>
PLACEHOLDER
  chown "${DEPLOY_USER}:${DEPLOY_USER}" "${WEBROOT}/index.html"
fi

step "Generating deploy SSH key"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/${DEPLOY_USER}/.ssh"
if [[ -f "$KEY_PATH" ]]; then
  echo "key already exists — reusing it"
else
  sudo -u "$DEPLOY_USER" ssh-keygen -t ed25519 -N "" -C "github-actions-deploy@${DOMAIN}" -f "$KEY_PATH"
fi
# Authorize the key for this account, without duplicating the entry on re-runs.
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
if ! grep -qxFf <(cat "${KEY_PATH}.pub") "/home/${DEPLOY_USER}/.ssh/authorized_keys"; then
  cat "${KEY_PATH}.pub" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
fi
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "/home/${DEPLOY_USER}/.ssh"
chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

step "Opening ports 80/443 (if ufw is active)"
if command -v ufw &>/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 80/tcp
  ufw allow 443/tcp
else
  echo "ufw inactive or absent — nothing to do"
fi

step "Applying bootstrap vhost (port 80, for the ACME challenge)"
cat > "$NGINX_CONF" <<BOOTSTRAP
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN} www.${DOMAIN};

    root ${WEBROOT};
    index index.html;
}
BOOTSTRAP
ln -sfn "$NGINX_CONF" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
nginx -t
systemctl reload nginx

step "Issuing the TLS certificate"
if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  echo "certificate already present — skipping issuance"
else
  certbot certonly --nginx \
    -d "$DOMAIN" -d "www.${DOMAIN}" \
    --non-interactive --agree-tos -m "$CERT_EMAIL" \
    --deploy-hook 'systemctl reload nginx'
fi

# The production vhost includes these two certbot-managed snippets.
for f in /etc/letsencrypt/options-ssl-nginx.conf /etc/letsencrypt/ssl-dhparams.pem; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: expected certbot to create ${f}, but it is missing." >&2
    echo "The production vhost includes it and nginx -t will fail. Aborting." >&2
    exit 1
  fi
done

step "Applying production vhost"
cat > "$NGINX_CONF" <<'PRODCONF'
# md-mini.com — static site
# Applied after certbot has issued the certificate (see deploy/README.md).

server {
    listen 80;
    listen [::]:80;
    server_name md-mini.com www.md-mini.com;
    return 301 https://md-mini.com$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name www.md-mini.com;

    ssl_certificate     /etc/letsencrypt/live/md-mini.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/md-mini.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    return 301 https://md-mini.com$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name md-mini.com;

    root /var/www/md-mini.com;
    index index.html;

    ssl_certificate     /etc/letsencrypt/live/md-mini.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/md-mini.com/privkey.pem;
    include             /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam         /etc/letsencrypt/ssl-dhparams.pem;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml text/plain application/xml;
    gzip_min_length 1024;
    gzip_vary on;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "frame-ancestors 'none'" always;

    location / {
        try_files $uri $uri/ =404;
        add_header Cache-Control "no-cache" always;
        # add_header in a location replaces ALL inherited add_header directives,
        # so security headers are repeated here.
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "frame-ancestors 'none'" always;
    }

    location ~* \.(png|jpg|jpeg|webp|ico|woff2)$ {
        add_header Cache-Control "public, max-age=2592000" always;
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;
        add_header Content-Security-Policy "frame-ancestors 'none'" always;
    }
}
PRODCONF
nginx -t
systemctl reload nginx

step "Verifying"
curl -sI "http://${DOMAIN}" | head -2 || true
curl -sI "https://${DOMAIN}" | head -2 || true

cat <<EOF


================================================================
 Provisioning done.

 Add these three GitHub Actions secrets to malinborn/mdmini:

   DEPLOY_HOST = $(curl -s4 --max-time 5 ifconfig.me || echo '<this server IP>')
   DEPLOY_USER = ${DEPLOY_USER}
   DEPLOY_SSH_KEY = the private key below (including BEGIN/END lines)

 Set the key without it passing through anyone's chat history:

   gh secret set DEPLOY_SSH_KEY --repo malinborn/mdmini < ${KEY_PATH}

 …or copy it from here:
================================================================

EOF
cat "$KEY_PATH"
echo
echo "================================================================"
