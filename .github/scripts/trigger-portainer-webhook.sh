#!/usr/bin/env bash
# Trigger a Portainer stack webhook with IMAGE_TAG=<short-sha>.
# Tries both /api/stacks/webhooks/ and /modules/docker/portainer/api/stacks/webhooks/.
set -euo pipefail

secret_name="${1:?secret name required}"
webhook_url="${2:-}"
required="${3:-false}"
deploy_tag="${DEPLOY_TAG:-${GITHUB_SHA::7}}"

append_image_tag() {
  local url="$1"
  local separator='?'
  if printf '%s' "$url" | grep -q '?'; then
    separator='&'
  fi
  printf '%s%sIMAGE_TAG=%s' "$url" "$separator" "$deploy_tag"
}

redact_url() {
  printf '%s' "$1" | sed -E 's#(/api/stacks/webhooks/)[^?]+#\1<redacted>#g'
}

trigger_stack_webhook() {
  webhook_url="$(printf '%s' "$webhook_url" | tr -d '\r\n')"

  if [ -z "$webhook_url" ]; then
    if [ "$required" = "true" ]; then
      echo "Missing secret: $secret_name" >&2
      return 1
    fi
    echo "Skipping optional $secret_name"
    return 0
  fi

  if ! printf '%s' "$webhook_url" | grep -Eq '^https?://'; then
    echo "Invalid $secret_name secret format" >&2
    return 1
  fi

  candidates=()
  candidates+=("$webhook_url")

  if printf '%s' "$webhook_url" | grep -q '/modules/docker/portainer/api/stacks/webhooks/'; then
    candidates+=("$(printf '%s' "$webhook_url" | sed 's#/modules/docker/portainer/api/stacks/webhooks/#/api/stacks/webhooks/#')")
  elif printf '%s' "$webhook_url" | grep -q '/api/stacks/webhooks/'; then
    candidates+=("$(printf '%s' "$webhook_url" | sed 's#/api/stacks/webhooks/#/modules/docker/portainer/api/stacks/webhooks/#')")
  fi

  attempted=()
  last_code=""

  for candidate in "${candidates[@]}"; do
    already_seen=0
    for seen in "${attempted[@]}"; do
      if [ "$seen" = "$candidate" ]; then
        already_seen=1
        break
      fi
    done
    [ "$already_seen" -eq 1 ] && continue
    attempted+=("$candidate")

    deploy_url="$(append_image_tag "$candidate")"
    http_code="$(curl \
      --request POST \
      --silent \
      --show-error \
      --output /dev/null \
      --write-out '%{http_code}' \
      --retry 3 \
      --retry-all-errors \
      "$deploy_url")"

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
      echo "$secret_name accepted ($(redact_url "$candidate")) IMAGE_TAG=$deploy_tag"
      return 0
    fi

    last_code="$http_code"
    echo "$secret_name attempt returned HTTP $http_code ($(redact_url "$candidate"))" >&2

    if [ "$http_code" != "404" ]; then
      break
    fi
  done

  echo "$secret_name trigger failed (last HTTP $last_code)." >&2
  echo "Check $secret_name points to your SchedKit stack webhook URL." >&2
  echo "Common formats (Plesk Portainer):" >&2
  echo "  - https://<host>/modules/docker/portainer/api/stacks/webhooks/<uuid>" >&2
  echo "  - https://<host>/api/stacks/webhooks/<uuid>" >&2
  return 1
}

trigger_stack_webhook
