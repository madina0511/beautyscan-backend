#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Layout: <root>/{frontend,backend}; deployment belongs to backend/deployment.
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd -- "$DEPLOY_DIR/../.." && pwd -P)"
CONFIG_FILE="${BEAUTYSCAN_COMPOSE_ENV:-/etc/beautyscan-ai/compose.env}"
die() { printf '%s\n' "$*" >&2; exit 1; }
for command in git docker flock; do
  command -v "$command" >/dev/null || die "Missing command: $command"
done
exec 9>"$DEPLOY_DIR/.deploy.lock"
flock -n 9 || die 'Another BeautyScan deployment is running.'
[[ -f "$CONFIG_FILE" && -r "$CONFIG_FILE" ]] || die 'Private Compose env file is missing or unreadable.'
compose=(docker compose --project-name beautyscan-ai --project-directory "$DEPLOY_DIR" --env-file "$CONFIG_FILE" -f "$DEPLOY_DIR/docker-compose.yml")
"${compose[@]}" config --quiet
docker info >/dev/null

# Preflight BOTH repositories before updating either. Never change branches.
for repo in backend frontend; do
  path="$ROOT_DIR/$repo"
  [[ "$(git -C "$path" rev-parse --show-toplevel)" == "$path" ]] || die "$repo must be a separate repository."
  [[ "$(git -C "$path" branch --show-current)" == master ]] || die "$repo must already be on master."
  [[ -z "$(git -C "$path" status --porcelain --untracked-files=all)" ]] || die "$repo has local changes; stopping."
done
for repo in backend frontend; do
  git -C "$ROOT_DIR/$repo" fetch --no-tags origin master
  git -C "$ROOT_DIR/$repo" merge-base --is-ancestor HEAD FETCH_HEAD || die "$repo diverged or is ahead of origin/master; stopping."
  # Pin fetched commits so later operations never depend on a moving branch.
  if [[ "$repo" == backend ]]; then
    backend_target="$(git -C "$ROOT_DIR/$repo" rev-parse FETCH_HEAD)"
  else
    frontend_target="$(git -C "$ROOT_DIR/$repo" rev-parse FETCH_HEAD)"
  fi
done
git -C "$ROOT_DIR/backend" merge --ff-only "$backend_target"
git -C "$ROOT_DIR/frontend" merge --ff-only "$frontend_target"
# Build both before touching running containers. No down, prune, or orphan removal.
"${compose[@]}" build --pull backend frontend
"${compose[@]}" up --detach --no-deps --wait --wait-timeout 180 backend frontend
"${compose[@]}" ps
printf 'Deployed backend=%s frontend=%s\n' "$backend_target" "$frontend_target"
