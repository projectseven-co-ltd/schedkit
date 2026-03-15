#!/bin/bash
# SchedKit Smoke Test — run after every deploy
# Usage: bash scripts/smoke-test.sh [host]
# Default host: https://schedkit.net

HOST=${1:-https://schedkit.net}
PASS=0
FAIL=0
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "${GRN}[✓] $1${NC}"; ((PASS++)); }
fail() { echo -e "${RED}[✗] $1${NC}"; ((FAIL++)); }
info() { echo -e "${YLW}[~] $1${NC}"; }

check() {
  local label="$1"
  local url="$2"
  local expect_field="$3"
  local method="${4:-GET}"
  local body="$5"
  local cookie="$6"

  local args=(-s -o /tmp/sk_response -w "%{http_code}" -X "$method")
  [[ -n "$body" ]] && args+=(-H "Content-Type: application/json" -d "$body")
  [[ -n "$cookie" ]] && args+=(-H "Cookie: $cookie")

  local code
  code=$(curl "${args[@]}" "$url")
  local resp
  resp=$(cat /tmp/sk_response)

  if [[ "$code" != "200" ]]; then
    fail "$label — HTTP $code"
    return
  fi

  if [[ -n "$expect_field" ]]; then
    if echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$expect_field' in d, 'missing'" 2>/dev/null; then
      local val
      val=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$expect_field',''))" 2>/dev/null)
      ok "$label — $expect_field: $val"
    else
      fail "$label — response missing field '$expect_field'. Got: $(echo $resp | head -c 200)"
    fi
  else
    ok "$label"
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  SchedKit Smoke Test — $HOST"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Core availability ──────────────────────────────
info "Core"
check "Site up"            "$HOST/"           ""
check "Version endpoint"   "$HOST/version"    "commit"
check "Swagger docs"       "$HOST/docs/json"  "info"

# ── Auth/me — CRITICAL: check all fields present ──
info "Auth — /v1/auth/me (unauthenticated should 401)"
code=$(curl -s -o /dev/null -w "%{http_code}" "$HOST/v1/auth/me")
if [[ "$code" == "401" || "$code" == "302" ]]; then
  ok "Auth/me rejects unauthenticated — HTTP $code"
else
  fail "Auth/me should reject unauthenticated — got HTTP $code"
fi

# ── Auth/me with real session ──────────────────────
# Get a fresh session token for jrj@p7n.net from NocoDB
SESSION_TOKEN=$(curl -s \
  "https://noco.app.p7n.net/api/v1/db/data/noco/pdrfbzgtno2cf9l/mv8osg9vdm7r13s?sort=-Id&limit=1&where=(user_id,eq,1)" \
  -H "xc-token: fDhJb1s9aK8yQsj99iSt6DOe9o518yGAwAdwezn1" | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(d['list'][0]['token'])" 2>/dev/null)

if [[ -n "$SESSION_TOKEN" ]]; then
  info "Auth — /v1/auth/me (authenticated)"
  COOKIE="sk_session=$SESSION_TOKEN"
  ME=$(curl -s -H "Cookie: $COOKIE" "$HOST/v1/auth/me")
  for field in Id name email slug plan api_key; do
    val=$(echo "$ME" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$field', 'MISSING'))" 2>/dev/null)
    if [[ "$val" == "MISSING" || -z "$val" ]]; then
      fail "/auth/me missing field: $field"
    else
      ok "/auth/me.$field = $val"
    fi
  done

  # ── Bookings ────────────────────────────────────
  info "Bookings"
  check "GET /v1/bookings"  "$HOST/v1/bookings?limit=5"  "bookings"  GET  ""  "$COOKIE"

  # ── Tickets ─────────────────────────────────────
  info "Tickets"
  TICKETS=$(curl -s -H "Cookie: $COOKIE" "$HOST/v1/tickets?limit=5")
  if echo "$TICKETS" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'tickets' in d" 2>/dev/null; then
    COUNT=$(echo "$TICKETS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['tickets']))" 2>/dev/null)
    ok "GET /v1/tickets — $COUNT tickets"
    # Check first ticket has all fields
    if [[ "$COUNT" -gt "0" ]]; then
      for field in Id title status priority; do
        val=$(echo "$TICKETS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['tickets'][0].get('$field','MISSING'))" 2>/dev/null)
        [[ "$val" == "MISSING" ]] && fail "tickets[0] missing: $field" || ok "tickets[0].$field = $val"
      done
    fi
  else
    fail "GET /v1/tickets — unexpected response: $(echo $TICKETS | head -c 100)"
  fi

  # ── Signals ─────────────────────────────────────
  info "Signals"
  check "GET /v1/signals"  "$HOST/v1/signals?limit=5"  "signals"  GET  ""  "$COOKIE"

  # ── Billing ─────────────────────────────────────
  info "Billing"
  PORTAL=$(curl -s -H "Cookie: $COOKIE" "$HOST/v1/billing/portal")
  if echo "$PORTAL" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'url' in d" 2>/dev/null; then
    ok "GET /v1/billing/portal — returns url"
  else
    fail "GET /v1/billing/portal — $(echo $PORTAL | head -c 100)"
  fi

else
  fail "Could not get session token from NocoDB — skipping authenticated tests"
fi

# ── Public booking page ──────────────────────────
info "Public pages"
check "Booking page loads"  "$HOST/book/jason/enterprise-intro"  ""

# ── Summary ─────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
TOTAL=$((PASS+FAIL))
if [[ $FAIL -eq 0 ]]; then
  echo -e "${GRN}  ALL $TOTAL CHECKS PASSED${NC}"
else
  echo -e "${RED}  $FAIL/$TOTAL CHECKS FAILED${NC}"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
exit $FAIL
