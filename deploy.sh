#!/usr/bin/env bash
# Deploys the Bioeng app to Firebase (project bioeng-c8397).
#
#   ./deploy.sh check   Check that everything is ready. Changes nothing.
#   ./deploy.sh         Deploy: tests, commit, Firestore rules, optional preview,
#                       publish the app, push to GitHub.
#
# Every step that changes something asks first; the default answer is "no".
# Users, passwords and data in Firebase are not touched: the only Firebase changes are
# the rules in firestore.rules and the files in docs/.
set -euo pipefail

PROJECT_ID="bioeng-c8397"
LIVE_URL="https://${PROJECT_ID}.web.app"
CONSOLE="https://console.firebase.google.com/project/${PROJECT_ID}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
DEFAULT_MESSAGE="Add in-app editor for analyses and reference ranges"
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

# In "check" mode a problem is reported and counted; otherwise it stops the script.
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

open_url() {
  if command -v open >/dev/null 2>&1; then open "$1" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1 || true
  fi
}

require_terminal() {
  [ -t 0 ] && [ -t 1 ] || fail "Run this yourself in a terminal: it asks before every step."
}

github_url() {
  git remote get-url origin | sed -E 's#^git@github\.com:#https://github.com/#; s#\.git$##'
}

tracked_backups() {
  git ls-files -- 'bioeng-backup-*.json' '*/bioeng-backup-*.json'
}

uncommitted_changes() {
  git status --porcelain --untracked-files=no
}

script_is_new() {
  ! git ls-files --error-unmatch deploy.sh >/dev/null 2>&1
}

# Output is captured before matching: with pipefail, "cmd | grep -q" can report a
# failure when grep stops reading early.
firebase_has_project() {
  local out
  out="$(firebase projects:list 2>/dev/null || true)"
  case "$out" in *"$PROJECT_ID"*) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------------------

preflight() {
  step "Checking the setup"
  cd "$ROOT"
  [ -f firebase.json ] && [ -f docs/index.html ] || fail "Run this from the Poliklinika-bioeng repository."
  local tool
  for tool in git node npm firebase; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is not installed."
  done
  ok "git, Node $(node --version), npm and Firebase CLI $(firebase --version) are installed"

  if [ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]; then
    problem "Switch to the main branch first: git checkout main"
  elif git rev-parse -q --verify MERGE_HEAD >/dev/null; then
    problem "A git merge is in progress. Finish or abort it first."
  else
    ok "On branch main"
  fi

  if grep -q "\"default\": \"$PROJECT_ID\"" .firebaserc && grep -q "projectId: \"$PROJECT_ID\"" docs/firebase-config.js; then
    ok "The app is configured for Firebase project $PROJECT_ID"
  else
    problem "docs/firebase-config.js or .firebaserc does not point at $PROJECT_ID."
  fi
  check_github
}

check_github() {
  info "Comparing with GitHub…"
  if ! git fetch --quiet origin main; then problem "Could not reach GitHub (git fetch origin main)."; return; fi
  local behind
  behind="$(git rev-list --count HEAD..origin/main)"
  if [ "$behind" -gt 0 ]; then
    git log --oneline HEAD..origin/main | sed 's/^/     /'
    problem "GitHub has $behind new commit(s) on main that are not here (above). Merge them first, then run this again."
  else
    ok "Nothing new on GitHub that is missing here"
  fi
}

check_firebase_login() {
  if firebase_has_project; then
    ok "Firebase CLI is logged in with access to $PROJECT_ID"
    return
  fi
  if [ "$CHECK_ONLY" = 1 ]; then problem "Firebase CLI is not logged in with access to $PROJECT_ID (run: firebase login)."; return; fi
  warn "The Firebase CLI is not logged in with an account that can access $PROJECT_ID."
  confirm "Log in now? (opens the browser)" || fail "Run 'firebase login', then start again."
  firebase login
  firebase_has_project || fail "This Google account cannot access $PROJECT_ID."
  ok "Firebase CLI is logged in with access to $PROJECT_ID"
}

run_tests() {
  local log
  log="$(mktemp -t bioeng-tests)"
  info "Running the tests…"
  if npm test >"$log" 2>&1; then
    ok "All $(grep -E '^# pass' "$log" | awk '{print $3}') tests pass"
    rm -f "$log"
  else
    tail -n 40 "$log" | sed 's/^/     /'
    rm -f "$log"
    problem "Tests fail (above). Fix them before deploying."
  fi
}

check_only() {
  CHECK_ONLY=1
  preflight
  step "Code"
  if [ -n "$(uncommitted_changes)" ]; then
    uncommitted_changes | sed 's/^/     /'
    info "These changes are not committed yet; './deploy.sh' commits them."
  else
    ok "Everything is committed"
  fi
  if script_is_new; then info "deploy.sh (this script) is new; './deploy.sh' commits it too."; fi
  if [ -n "$(tracked_backups)" ]; then
    tracked_backups | sed 's/^/     /'
    warn "Patient backups are tracked by git and published with every push; './deploy.sh' offers to remove them."
  else
    ok "No patient backups are tracked by git"
  fi
  run_tests
  step "Firebase"
  check_firebase_login

  step "Result"
  if [ "$PROBLEMS" -eq 0 ]; then
    ok "Ready. Next: ./deploy.sh"
  else
    fail "$PROBLEMS thing(s) to fix first (marked with !)."
  fi
}

# ---------------------------------------------------------------------------------------
# Deploy
# ---------------------------------------------------------------------------------------

commit_changes() {
  step "Commit your changes"
  if [ -z "$(uncommitted_changes)" ] && ! script_is_new; then
    ok "Nothing to commit"
    return
  fi
  uncommitted_changes | sed 's/^/     /'
  if script_is_new; then info "A  deploy.sh (this script)"; fi
  local others
  others="$(git ls-files --others --exclude-standard | grep -v '^deploy\.sh$' || true)"
  if [ -n "$others" ]; then
    info "Not included (new files you have not added yourself):"
    printf '%s\n' "$others" | sed 's/^/       /'
  fi
  confirm "Commit the files listed above?" || fail "Stopped. Commit them yourself or run this again."
  local message
  read -r -p "   Commit message [$DEFAULT_MESSAGE]: " message || true
  git add -u
  if script_is_new; then git add -- deploy.sh; fi
  git commit -q -m "${message:-$DEFAULT_MESSAGE}"
  ok "Committed: $(git log -1 --format='%h %s')"
}

untrack_backups() {
  local files
  files="$(tracked_backups)"
  [ -n "$files" ] || return 0
  step "Patient backups in the repository"
  printf '%s\n' "$files" | sed 's/^/     /'
  warn "These files hold patient data and are published with every push."
  if confirm "Stop tracking them? (the files stay on your disk)"; then
    printf '%s\n' "$files" | while IFS= read -r file; do git rm -q --cached -- "$file"; done
    git commit -q -m "Remove clinical backups from the repository"
    ok "Removed from the repository. They still exist in older commits until the history is cleaned."
  else
    warn "Left as they are."
  fi
}

deploy_rules() {
  step "Firestore rules"
  info "Adds access rules for the analysis list (analysisCatalog, catalogHistory)."
  info "The rules for patients, reports and the rest are unchanged. This replaces the"
  info "rules in the Firebase Console with firestore.rules, so edits made directly in"
  info "the console would be lost."
  confirm "Publish firestore.rules and firestore.indexes.json to $PROJECT_ID?" || fail "Stopped before publishing the rules."
  firebase deploy --only firestore:rules,firestore:indexes --project "$PROJECT_ID"
  ok "Rules are live"
}

preview() {
  step "Optional: test on a temporary address first"
  if ! confirm "Deploy a 7-day preview before publishing?"; then
    info "Skipped."
    return
  fi
  local output url
  info "Deploying the preview (about a minute)…"
  # --json never prompts, so capturing the output cannot hide a question.
  if ! output="$(firebase hosting:channel:deploy preview --expires 7d --project "$PROJECT_ID" --json 2>&1)"; then
    printf '%s\n' "$output" | sed 's/^/     /'
    fail "The preview deploy failed (above). Nothing is published."
  fi
  url="$(printf '%s\n' "$output" | grep -Eo 'https://[A-Za-z0-9.-]+\.web\.app' | head -n 1 || true)"
  if [ -n "$url" ]; then
    ok "Preview address: $url"
    open_url "$url"
  else
    printf '%s\n' "$output" | sed 's/^/     /'
    warn "Could not find the preview address in the output above."
  fi
  info "Log in there as the laboratory and open «Analizat dhe vlerat referente»."
  info "If login fails with a domain error, add the preview domain under Authorized domains:"
  info "  $CONSOLE/authentication/settings"
  confirm "Does the preview work?" || fail "Stopped. Nothing is published; the clinic still has the current version."
}

publish() {
  step "Publish the app"
  confirm "Publish docs/ to $LIVE_URL?" || fail "Stopped before publishing."
  firebase deploy --only hosting --project "$PROJECT_ID"
  ok "The new version is live at $LIVE_URL"
}

push_code() {
  step "Push the code to GitHub"
  check_github
  local ahead
  ahead="$(git rev-list --count origin/main..HEAD)"
  if [ "$ahead" -eq 0 ]; then ok "GitHub is already up to date"; return; fi
  git log --oneline origin/main..HEAD | sed 's/^/     /'
  info "Note: index.html moves from the repository root to docs/, so a GitHub Pages"
  info "site built from the root stops showing the app ($(github_url)/settings/pages)."
  confirm "Push these $ahead commit(s) to GitHub?" || fail "Stopped before pushing. The app is already published."
  git push origin main
  ok "Pushed to GitHub"
}

finish() {
  step "Done: check the new feature"
  info "1. Open $LIVE_URL and reload the page (anyone with the app open"
  info "   keeps the old version until they reload)."
  info "2. Log in as the laboratory. Under «Raportet e pacientit» there is a new section"
  info "   «Analizat dhe vlerat referente». It shows «Versioni 1»: the list is stored in"
  info "   Firebase automatically on this first laboratory login."
  info "3. Change one reference value and save: «Versioni 2». Add that analysis to a"
  info "   report to see the new value, then change it back if it was only a test."
  info "4. On another computer, after a reload, the same change appears."
}

deploy() {
  require_terminal
  preflight
  run_tests
  commit_changes
  untrack_backups
  step "Firebase"
  check_firebase_login
  deploy_rules
  preview
  publish
  push_code
  finish
}

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
}

case "${1:-deploy}" in
  -h|--help|help) usage ;;
  check) check_only ;;
  deploy) deploy ;;
  *) usage; exit 1 ;;
esac
