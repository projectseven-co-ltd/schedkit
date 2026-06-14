#!/bin/sh
set -e

if [ -n "${GIT_SHA:-}" ] && [ "${GIT_SHA}" != "unknown" ]; then
  printf '%s\n' "$GIT_SHA" > /app/.git-sha
fi

exec "$@"
