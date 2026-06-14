# Plesk maintenance page (schedkit.net)

Shows a static **Stand down** page when the SchedKit container is restarting or unreachable (502/503/504).

## 1. Install the HTML file on the server

SSH to the Plesk host and run (adjust path if your vhost docroot differs):

```bash
cd /path/to/schedkit   # or clone/pull the repo on the server
chmod +x deploy/plesk/install-maintenance.sh
./deploy/plesk/install-maintenance.sh
```

Or copy manually:

```bash
cp deploy/plesk/maintenance.html /var/www/vhosts/schedkit.net/httpdocs/maintenance.html
chmod 644 /var/www/vhosts/schedkit.net/httpdocs/maintenance.html
```

## 2. Add nginx directives in Plesk

1. **Plesk** → **Domains** → **schedkit.net**
2. **Apache & nginx Settings**
3. Scroll to **Additional nginx directives**
4. Paste the contents of `nginx-additions.conf`

### If schedkit.net already proxies to `:3002`

Do **not** add a second `location /` block. Only add these lines **inside your existing** `location / { ... }` that proxies to Portainer:

```nginx
proxy_intercept_errors on;
error_page 502 503 504 /maintenance.html;
```

And add this **once** at server level (same Additional directives box):

```nginx
location = /maintenance.html {
    root /var/www/vhosts/schedkit.net/httpdocs;
    internal;
    default_type text/html;
    add_header Retry-After "120" always;
    add_header Cache-Control "no-store" always;
}
```

5. Click **OK** / **Apply**. Plesk reloads nginx.

## 3. Test

```bash
# Stop API briefly (Portainer stack or docker stop schedkit-api)
curl -sI https://schedkit.net/ | head -5
# Expect: HTTP/2 503 (or 502) and HTML body with "Stand down"

# Start API again
curl -s https://schedkit.net/health
# Expect: {"status":"ok",...}
```

Direct URL `https://schedkit.net/maintenance.html` returns **404** by design (`internal` — only shown via error_page). To preview, temporarily remove the `internal;` line.

## Planned maintenance (app still running)

Set in Portainer stack env (not nginx):

```env
MAINTENANCE_MODE=true
```

Update stack, then set back to `false` when done. The app serves the same page from `public/maintenance.html`.

## Layers

| When | Who serves the page |
|------|---------------------|
| Container down / restart | **Plesk nginx** → `httpdocs/maintenance.html` |
| `MAINTENANCE_MODE=true` | **SchedKit app** (or Plesk if `proxy_intercept_errors on`) |
| Normal | SchedKit app |
