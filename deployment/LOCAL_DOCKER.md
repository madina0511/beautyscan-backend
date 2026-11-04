# Local Windows Docker configuration

Run this standalone configuration from the `beauty-ai` workspace root with Docker Desktop's Linux engine running. Do not combine it with the production Compose file. It uses a separate project, image tags, networks, and media volume. Ports 3100 and 3101 must be free.

The backend repository owns this deployment directory. Keep the frontend repository at the sibling `frontend/` path. On a fresh clone, provision the ignored `backend/.env` and `backend/credentials/google-vision.json` privately. Create `frontend/.env.local` from the reviewed `frontend/.env.example` only if it does not already exist; never overwrite an existing environment file. The environment-key checklist below describes the backend's local requirements.

```powershell
docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml config --quiet
docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml up -d --build --wait --wait-timeout 180
```

Open http://localhost:3100. The API is http://localhost:3101/graphql. Use `localhost` consistently for both services; switching one to `127.0.0.1` changes browser origin/cookie behavior. Rebuilding is necessary because the browser API URL is fixed at build time. `frontend/.env.local` supplies only the explicitly selected public currency-rate build arguments; its API URL cannot override the fixed local URL. No backend secrets are used as build arguments.

The existing `backend/.env` is mounted read-only at `/app/.env`, without modifying or copying it. The existing Nest ConfigModule reads it with the application's dotenv parser. This preserves whitespace around assignments and literal dollar signs in secrets, which Compose env parsing does not handle identically. The local Compose environment overrides only NODE_ENV, PORT, FRONTEND_URL, GOOGLE_APPLICATION_CREDENTIALS, and guest SameSite; Nest ConfigModule gives those process variables precedence. `NODE_ENV=development` selects `PHOTOROOM_API_KEY` (Sandbox) and HTTP-compatible auth/guest cookies. Existing code prefixes Sandbox credentials as needed. Production credentials are not selected. Limits, guest enablement, and provider keys remain those in the existing env. The frontend still runs a compiled Next.js production build.

Google Vision credentials are mounted read-only at `/run/secrets/google_vision`, only in the backend. The existing host credential path is overridden with that container path. Both Docker build allowlists exclude env files, credential directories, and uploads. Secrets remain in ignored host files and the backend's runtime configuration, accessible to Docker administrators; do not publish resolved Compose output or container inspection output.

The existing MONGO_URI is retained. Inspection found a non-loopback MongoDB host, so no `localhost` rewrite or additional Mongo container is used. Database connectivity, firewall/DNS/TLS access and credential validity still need runtime verification. Startup initializes application indexes and guest cleanup against that configured database; this is not a read-only database test. If it is a shared database, guest records can refer to media in another environment. Use an approved local/test database for isolation. This configuration does not overwrite MONGO_URI or change schemas.

All `/app/uploads` content persists in the private `beautyscan-ai-local_local_uploads` volume, accessible only to the backend through the existing authorized controllers. The image seeds ownership for UID/GID 1000 and mode 0700 on a new volume. Existing host uploads and production volumes are not mounted or changed. Previously saved media in MongoDB will require the matching files to be migrated separately; a new volume starts empty. Do not use `down -v` or prune volumes if you need to retain local images.

Safe smoke checks, after startup:

```powershell
docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml ps
curl.exe --fail http://localhost:3100/
Invoke-RestMethod -Uri http://localhost:3101/graphql -Method Post -ContentType 'application/json' -Body '{"query":"{ getHello }"}'
# Local file-read checks only: no Google, OCR, Photoroom, or OpenRouter request.
@'
const fs = require('fs');
const c = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
if (c.type !== 'service_account' || !c.private_key || !c.client_email) process.exit(1);
fs.accessSync('/app/.env', fs.constants.R_OK);
fs.accessSync('/app/uploads', fs.constants.R_OK | fs.constants.W_OK);
console.log('Env and credentials readable; media volume writable');
'@ | docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml exec -T backend node
```

The `getHello` health check and frontend page check make no paid provider requests. Actual OCR and AI description generation contact Google/OpenRouter and may incur charges, so they are not part of validation. Avoid upload/preview/generate and password-reset actions during a no-paid-call smoke test. Authentication can be exercised manually using a local test account; no accounts or sessions were created during configuration preparation.

Stop only this local stack, retaining images and data:

```powershell
docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml stop
```

## Signup returns Too Many Requests

Signup intentionally allows three guarded attempts per client IP per hour, not three successful accounts. DTO validation failures and service rejections after the guard also consume attempts. The fourth guarded attempt starts a one-hour block with the installed throttler's default block duration. Login is a separate bucket (five attempts per minute); the unguarded getHello health query consumes no signup quota. The frontend signup path sends one request per submission and has no automatic signup retry.

Local Docker Desktop forwards host connections through the bridge gateway. A read-only socket check during a getHello request observed peer `172.21.0.1`; the running image's signup metadata confirmed limit 3 and TTL 3,600,000 ms. The current Express policy trusts only loopback proxies, so local browser sessions share the bridge IP's signup bucket. Client-supplied X-Forwarded-For cannot bypass that policy. Do not enable blanket trust-proxy or weaken production signup limits to work around local testing.

Wait for Retry-After to expire, or reset the local backend's in-memory auth throttle state with this command from the workspace root:

```powershell
docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml restart backend
```

No rebuild is required for this recovery. Restart briefly interrupts the local backend; it retains MongoDB accounts and the private media volume. It does not reset persistent guest/provider budgets. This command is for local development recovery, not a production rate-limit workaround. No application or proxy-policy change was necessary. Focused guard tests cover threshold/block expiry, rejected downstream attempts, shared Docker IPs, separate IP/login buckets, and forwarding-header spoof resistance. Historical request counts were not available from logs, so the exact sequence of earlier submissions was not reconstructed.

## Configuration inspection — 2026-11-04 (Asia/Seoul)

Checked actual source lookups and existing env values without printing secrets:

| Application setting | Check |
| --- | --- |
| MONGO_URI | Present; non-loopback host; URI structure checked |
| JWT_ACCESS_SECRET | Present; at least 32 bytes |
| JWT_REFRESH_EXPIRES_IN | Present; application duration syntax checked |
| RESEND_API_KEY, RESEND_FROM_EMAIL | Present; required for startup/password-reset delivery |
| OPENROUTER_API_KEY | Present; required by description service constructor |
| PHOTOROOM_API_KEY | Present; Sandbox path selected by local NODE_ENV |
| PHOTOROOM_PRODUCTION_API_KEY | Not required in local Sandbox mode |
| PHOTOROOM_DAILY_CALL_LIMIT | Valid positive integer, at most 100 |
| PHOTOROOM_MAX_CONCURRENT | Valid positive integer, at most 4 |
| PHOTOROOM_GUEST_ENABLED | Existing value enables guest previews; preserved |
| PHOTOROOM_GUEST_HASH_SECRET | Present; at least 32 bytes |
| PHOTOROOM_GUEST_IP_HOURLY_LIMIT | Valid positive integer, at most 10 |
| PHOTOROOM_GUEST_MAX_ACTIVE | Valid positive integer, at most 4 |
| PHOTOROOM_GUEST_COOKIE_SAMESITE | Local override is lax, compatible with HTTP |
| GOOGLE_APPLICATION_CREDENTIALS | Container path points to existing read-only service-account secret |
| NODE_ENV, PORT, FRONTEND_URL | Local overrides select Sandbox, port 3000 internally, browser origin localhost:3100 |
| NEXT_PUBLIC_GRAPHQL_URL | Build-time localhost:3101/graphql |
| NEXT_PUBLIC_USD_TO_UZS, NEXT_PUBLIC_USD_TO_KRW | Optional approved public rates from frontend/.env.local; blank means unavailable |

Compose model, application dotenv parsing, and local override precedence were validated without printing secret values. Docker Engine was unavailable in this session (desktop-linux pipe missing), so containers, MongoDB connectivity, cookie flow, Linux credential permissions, image contents, and volume access have not been runtime-verified. The user reported existing image builds passed. No provider calls, commits, pushes or VPS deployment were performed. Existing production files and env files remain unchanged.

Passed `docker compose --env-file frontend/.env.local -f backend/deployment/docker-compose.local.yml config --quiet`. Also ran the actual Nest ConfigModule locally with the Compose overrides: every inherited env value matched the application's dotenv parsing exactly, and all five overrides took precedence. Checked loopback bindings, credential source existence, refresh-duration syntax, separate project name, and absence of frontend runtime secret injection. Git checks confirmed `backend/.env` and the Google credential file are ignored and untracked. No AppModule was initialized, so these checks made no MongoDB or provider connection.
