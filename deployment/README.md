# BeautyScan AI deployment

Prepared configuration, not a VPS deployment. No application code or existing Nginx configuration is changed. Kiddo reference files were not available locally. Docker Engine validation must be completed before release.

## Layout and ownership

Keep the two independent clones side by side; the backend repository owns the shared deployment directory:

```text
/srv/beautyscan-ai/
  backend/       # backend Git repository, master
    deployment/  # shared Compose files, script, and deployment instructions
  frontend/      # frontend Git repository, master
/etc/beautyscan-ai/
  compose.env
  backend.env
  google-service-account.json
```

Dockerfiles and .dockerignore files belong in their respective application repositories. The backend repository owns the single shared deployment directory; do not duplicate these files in the frontend repository. Compose contexts resolve to the backend root and sibling frontend repository. Neither application repo includes the other's Git history.

Use Docker Engine with Compose **2.30 or newer** (`env_file.format: raw`) on Ubuntu. Node 24.22.2 and npm 11.19.1 match both existing package engine requirements. Runtime containers run as UID/GID 1000 with dropped capabilities. Each service has its own project-scoped bridge network; outbound access is required for the configured database and external providers. No database is created: supply a dedicated production MongoDB connection and manage backups independently. A host-only MongoDB bound to loopback is not reachable as localhost from Docker.

Copy `.env.example` to private `compose.env`, and `backend.env.example` to private `backend.env`. Fill placeholders using a private editor; preserve any approved provider limits and feature settings from your existing environment. Do not copy secrets into commands, build args, Compose YAML or image layers. `NEXT_PUBLIC_*` values are public and baked into browser bundles; changing them requires rebuilding. Use HTTPS sibling frontend/API domains under the same site for existing cookie behavior. FRONTEND_URL must exactly match the browser origin. The API URL must be absolute and end in `/graphql`; image endpoints use that URL's origin.

Restrict `/etc/beautyscan-ai` and env files to the deployment operator (directory 0700, env files 0600). Compose grants only the backend access to Google credentials as a read-only file at `/run/secrets/google_service_account`. File-backed Compose secrets retain host permissions; ensure UID 1000 can read this file (for example owner UID 1000 and mode 0400 inside the restricted directory). Verify this locally before starting. Docker administrators can inspect container environment; protect Docker access. Never print `docker compose config` without `--quiet` against production configuration.

## Private media and existing data

The `beautyscan-ai_uploads` named volume persists the entire `/app/uploads` tree, including original, final, temporary and guest-private files. New volumes inherit the image directory's UID 1000 and mode 0700. Existing volumes require compatible ownership. Only the backend mounts media; do not add an Nginx alias, public static mount or frontend mount. Existing authenticated media controllers remain responsible for access checks. Before first production start, migrate any existing uploads offline into this volume, preserve paths, set UID/GID 1000 and restrictive permissions, and back it up alongside MongoDB. Never run `down -v` or volume pruning. Local engine builds cannot verify existing data migration.

## Host Nginx integration (review only; do not apply automatically)

In a dedicated frontend HTTPS virtual host, proxy `/` to `http://127.0.0.1:3100`. In a dedicated API HTTPS virtual host, proxy **all paths** to `http://127.0.0.1:3101` with the original URI intact. Proxying only `/graphql` breaks uploads, guest previews and authenticated image retrieval. Configure these directives in each appropriate location:

```nginx
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 130s;
proxy_send_timeout 130s;
```

Set `client_max_body_size 12m` in the API server (application file limit remains 10 MB). Disable proxy caching for API and private media. Configure TLS using the existing host setup. No Nginx reload or file edits are performed by deploy.sh.

**Release prerequisite:** `backend/src/main.ts` currently trusts only loopback proxies. Docker bridge forwarding normally presents a non-loopback peer, so guest IP limits can group users behind that peer. Review the actual Nginx → Docker peer addresses and approve a narrowly scoped application trust-proxy change before production release; do not enable blanket trust. Application security settings were deliberately preserved. Verify distinct client IPs and spoofed forwarding headers on the final VPS topology. This cannot be established from local files.

## Exact local checks (PowerShell, from workspace root)

These first checks do not start services or make paid provider calls:

```powershell
& 'C:/Program Files/Git/bin/bash.exe' -n backend/deployment/deploy.sh
docker compose --env-file backend/deployment/.env.example -f backend/deployment/docker-compose.yml config --quiet --no-env-resolution
docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml build backend frontend
```

The example public API hostname is deliberately a placeholder. For a runtime smoke test, create private local env and credential files **outside Git** and set their absolute paths in a private Compose env file. Use a dedicated local/test MongoDB (never production), valid test-only configuration, `PHOTOROOM_GUEST_ENABLED=false`, and no paid production credentials. Use `NEXT_PUBLIC_GRAPHQL_URL=http://localhost:3101/graphql` and `FRONTEND_URL=http://localhost:3100` for localhost rendering checks. Production secure cookies require HTTPS; full authentication/guest smoke tests need local HTTPS proxy domains. Do not invoke OCR, image generation, description generation, or password reset as smoke checks.

```powershell
# Replace this path with your private local Compose configuration.
$testConfig = 'C:/private/beautyscan-ai/compose.env'
docker compose --env-file $testConfig -f backend/deployment/docker-compose.yml config --quiet
docker compose --env-file $testConfig -f backend/deployment/docker-compose.yml build backend frontend
docker compose --env-file $testConfig -f backend/deployment/docker-compose.yml up -d --no-deps --wait --wait-timeout 180 backend frontend
docker compose --env-file $testConfig -f backend/deployment/docker-compose.yml ps
curl.exe --fail http://127.0.0.1:3100/
Invoke-RestMethod -Uri http://127.0.0.1:3101/graphql -Method Post -ContentType 'application/json' -Body '{"query":"{ getHello }"}'
docker compose --env-file $testConfig -f backend/deployment/docker-compose.yml stop backend frontend
```

Backend health checks execute only the existing `getHello` query; startup already awaits MongoDB indexes. This is a process/startup check, not continuous database/provider readiness. Frontend health checks render `/`. Unhealthy status alone does not restart a live process; restart policies recover exited processes. Neither health check invokes paid APIs. Do not start this stack if host ports 3100/3101 are already occupied.

## Future Ubuntu deployment commands — do not run yet

After the prepared files have been reviewed and published through each repository's approved workflow, clone both master branches into the layout above, provision private configuration and backups, resolve the proxy prerequisite, and then:

```bash
cd /srv/beautyscan-ai
bash -n backend/deployment/deploy.sh
docker compose --env-file /etc/beautyscan-ai/compose.env -f backend/deployment/docker-compose.yml config --quiet
bash backend/deployment/deploy.sh
```

`BEAUTYSCAN_COMPOSE_ENV=/absolute/path/compose.env bash backend/deployment/deploy.sh` selects another private config. The script locks simultaneous deployments, rejects dirty/non-master/divergent/ahead checkouts, fetches origin/master, pins the fetched commits and merges fast-forward only. It builds both images before replacing containers and targets only `backend` and `frontend` within project `beautyscan-ai`. It never runs reset, force, down, prune, orphan removal, or host Nginx commands. Keep that project name reserved for this stack.

This is not an atomic or zero-downtime deploy: failed builds leave running containers unchanged but may leave source checkouts advanced; failed startup can leave a mixed release. It exits nonzero on failure and does not attempt destructive rollback. Save previous commit IDs and image IDs before deployment and keep separate backup image tags for an operator-reviewed rollback. Do not use Git reset to recover. Inspect logs privately because application errors may contain operational details.
