#!/usr/bin/env bash
# The Firebase emulators need Java 21 or newer. When SDKMAN is installed and has the
# version named in .sdkmanrc, use it for this command only; otherwise use the java on PATH.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
version="$(sed -n 's/^java=//p' "$root/.sdkmanrc" 2>/dev/null || true)"
candidate="${SDKMAN_DIR:-$HOME/.sdkman}/candidates/java/$version"

if [ -n "$version" ] && [ -x "$candidate/bin/java" ]; then
  export JAVA_HOME="$candidate"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

exec "$@"
