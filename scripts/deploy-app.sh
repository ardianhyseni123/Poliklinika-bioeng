#!/usr/bin/env bash
# Deploys the rebuilt app (src/, built into dist/) to Firebase project bioeng-c8397.
#
#   scripts/deploy-app.sh check     Check that everything is ready. Changes nothing.
#   scripts/deploy-app.sh cutover   The one-time switch from the old app (see CUTOVER.md).
#   scripts/deploy-app.sh           Deploy a new version after the cutover.
#
# Uses firebase.next.json: the rules in firestore.v2.rules and the files in dist/.
# Every step that changes something asks first; the default answer is "no".
# It never commits or pushes: git stays with you.
set -euo pipefail

PROJECT_ID="bioeng-c8397"
LIVE_URL="https://${PROJECT_ID}.web.app"
CONSOLE="https://console.firebase.google.com/project/${PROJECT_ID}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG="firebase.next.json"
MARKER=".cutover-complete"
CHECK_ONLY=0
PROBLEMS=0

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

step() { printf '\n%s== %s ==%s\n' "$BOLD" "$1" "$RESET"; }
info() { printf '   %s\n' "$*"; }
ok()   { printf '   %s✓%s %s\n' "$GREEN" "$RESET" "$*"; }
warn() { printf '   %s!%s %s\n' "$YELLOW" "$RESET" "$*"; }
fail() { printf '\n%s✗ %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }
problem() {
  if [ "$CHECK_ONLY" = 1 ]; then warn "$*"; PROBLEMS=$((PROBLEMS + 1)); else fail "$*"; fi
}

confirm() {
  local answer
  read -r -p "   $1 [y/N] " answer || return 1
  case "$(printf '%s' "$answer" | tr '[:upper:]' '[:lower:]')" in
    y|yes|po) return 0 ;;
    *) return 1 ;;
  esac
}

require_terminal() {
  [ -t 0 ] && [ -t 1 ] || fail "Run this yourself in a terminal: it asks before every step."
}

firebase_has_project() {
  local out
  out="$(firebase projects:list 2>/dev/null || true)"
  case "$out" in *"$PROJECT_ID"*) return 0 ;; *) return 1 ;; esac
}

preflight() {
  step "Checking the setup"
  cd "$ROOT"
  [ -f "$CONFIG" ] && [ -f firestore.v2.rules ] && [ -f package.json ] || fail "Run this from the Poliklinika-bioeng repository."
  local tool
  for tool in git node npm firebase; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed."
  done
  ok "git, Node $(node --version), npm and Firebase CLI $(firebase --version) are installed"
  if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then problem "Switch to the main branch first: git checkout main"; else ok "On branch main"; fi
  if [ -n "$(git status --porcelain)" ]; then
    warn "There are uncommitted changes; what gets deployed is the files on this computer:"
    git status --short | head -n 20 | sed 's/^/     /'
  else
    ok "Everything is committed"
  fi
  if grep -q "\"default\": \"$PROJECT_ID\"" .firebaserc; then ok "Firebase project: $PROJECT_ID"; else problem ".firebaserc does not point at $PROJECT_ID."; fi
  if firebase_has_project; then ok "Firebase CLI is logged in with access to $PROJECT_ID"; else problem "Run 'firebase login' with an account that can access $PROJECT_ID."; fi
}

run_tests() {
  step "Tests"
  local log
  log="$(mktemp -t bioeng-tests)"
  info "Type check, lint, unit, rules, data layer, old-app tests… (a few minutes)"
  if npm test >"$log" 2>&1; then ok "npm test passes"; else tail -n 40 "$log" | sed 's/^/     /'; rm -f "$log"; problem "npm test fails (above)."; return; fi
  info "End-to-end tests and the print comparison with the old app…"
  if npm run test:e2e >"$log" 2>&1; then ok "$(grep -Eo '[0-9]+ passed' "$log" | tail -n 1) end-to-end"; else tail -n 40 "$log" | sed 's/^/     /'; problem "End-to-end tests fail (above)."; fi
  rm -f "$log"
}

build() {
  step "Build"
  npm run build >/dev/null 2>&1 || fail "npm run build fails. Run it to see why."
  grep -q "$PROJECT_ID" dist/assets/*.js || fail "The build does not point at $PROJECT_ID."
  if grep -q "demo-bioeng" dist/assets/*.js; then fail "The build still contains the emulator project; refusing to deploy."; fi
  ok "dist/ is built for $PROJECT_ID"
}

cutover_checklist() {
  step "Before the switch (CUTOVER.md, part 1)"
  info "The old app reads roles from custom claims; the new one from the 'users' collection."
  confirm "Did 'npm run users -- migrate --commit' run, and does 'npm run users -- list' show everyone with 'new app: yes'?" || fail "Do that first (tools/firebase-import/README.md)."
  confirm "Are you an Administrator in the new app (npm run users -- set <you> --role Administrator ...)?" || fail "Make yourself Administrator first, or nobody can change roles in the app."
  confirm "Is public sign-up turned off (Authentication → Settings → User actions → no 'Enable create')?" || fail "Turn it off first: $CONSOLE/authentication/settings"
  confirm "Will staff use the same address as before ($LIVE_URL)? The old app's attachments are only found there." || fail "See CUTOVER.md: attachments are only brought over on the address the old app ran on."
  confirm "Have staff closed the app (a quiet time)?" || fail "Pick a quiet time and ask staff to close the app."
}

deploy_rules() {
  step "Firestore rules"
  if [ "$1" = cutover ]; then
    info "Replaces the old rules with firestore.v2.rules. From this moment the old app stops"
    info "working (it reads roles from claims); the new app below must go live right after."
  fi
  confirm "Publish firestore.v2.rules and firestore.indexes.json to $PROJECT_ID?" || fail "Stopped before the rules. Nothing changed."
  firebase --config "$CONFIG" deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"
  ok "Rules are live"
}

publish() {
  step "Publish the app"
  confirm "Publish dist/ to $LIVE_URL?" || fail "Stopped before publishing. If the rules went out, publish now or roll back (CUTOVER.md)."
  firebase --config "$CONFIG" deploy --only hosting --project "$PROJECT_ID"
  ok "Live at $LIVE_URL"
}

deploy() {
  local mode="$1"
  require_terminal
  if [ "$mode" = cutover ] && [ -f "$ROOT/$MARKER" ]; then fail "The cutover already happened ($(cat "$ROOT/$MARKER")). Use: scripts/deploy-app.sh"; fi
  if [ "$mode" = update ] && [ ! -f "$ROOT/$MARKER" ]; then fail "The cutover has not happened yet. Read CUTOVER.md, then: scripts/deploy-app.sh cutover"; fi
  preflight
  run_tests
  build
  [ "$mode" = cutover ] && cutover_checklist
  deploy_rules "$mode"
  publish
  if [ "$mode" = cutover ]; then
    printf 'cutover %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" >"$ROOT/$MARKER"
    ok "Wrote $MARKER: the old ./deploy.sh now refuses to run. Commit it with the rest."
    step "Right after the switch (CUTOVER.md, part 3)"
    info "1. Open $LIVE_URL, reload, log in as yourself; check the Users page."
    info "2. Each person logs in on every computer they used: their attachments come over (held reports are not uploaded)."
    info "3. Watch for the yellow notice «nuk u pranuan»; then assign patients to the doctors («Specialistët e pacientit»)."
  fi
}

check_only() {
  CHECK_ONLY=1
  preflight
  run_tests
  build
  step "Result"
  if [ -f "$ROOT/$MARKER" ]; then info "Cutover done: $(cat "$ROOT/$MARKER")."; else info "Cutover not done yet: scripts/deploy-app.sh cutover"; fi
  if [ "$PROBLEMS" -eq 0 ]; then ok "Ready."; else fail "$PROBLEMS thing(s) to fix first (marked with !)."; fi
}

case "${1:-update}" in
  -h|--help|help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//' ;;
  check) check_only ;;
  cutover) deploy cutover ;;
  update) deploy update ;;
  *) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
