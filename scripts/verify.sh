#!/usr/bin/env bash
# The single gate. Stages stop at the first failure.
# Usage: ./scripts/verify.sh [--fast]   (--fast runs the tests only)
set -euo pipefail

cd "$(dirname "$0")/.."

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

stage() { printf '\n== %s\n' "$1"; }
skip() { printf 'skipped: %s\n' "$1"; }

run_tests() {
  stage "2. tests"
  if [ -d test ]; then
    node --test
  else
    skip "no test directory yet"
  fi
}

if [ "$FAST" -eq 1 ]; then
  run_tests
  printf '\nverify (fast): ok\n'
  exit 0
fi

stage "1. dependencies"
if [ -f package-lock.json ]; then
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    npm ci
  else
    echo "node_modules is current"
  fi
else
  skip "no package-lock.json yet"
fi

run_tests

stage "3. copy check"
if [ -f scripts/check-copy.mjs ] && { [ -d src/views ] || [ -d prompts ]; }; then
  node scripts/check-copy.mjs
else
  skip "scripts/check-copy.mjs or the directories it scans do not exist yet"
fi

stage "4. colour check"
if [ -d public ] || [ -d src ]; then
  targets=()
  [ -d public ] && targets+=(public)
  [ -d src ] && targets+=(src)
  hits=$(grep -rnIE --include='*.css' --include='*.js' --include='*.html' \
    '#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|rgba?\(' "${targets[@]}" 2>/dev/null \
    | grep -v '^public/tokens\.css:' || true)
  if [ -n "$hits" ]; then
    echo "colour values found outside public/tokens.css:"
    echo "$hits"
    exit 1
  fi
  echo "no colour values outside public/tokens.css"
else
  skip "no public or src directory yet"
fi

stage "5. layering check"
if [ -d src/core ]; then
  bad=$(grep -rnE "from ['\"]\.\./(routes|views)" src/core || true)
  if [ -n "$bad" ]; then
    echo "src/core must not import from routes or views:"
    echo "$bad"
    exit 1
  fi
  bad=$(grep -rn 'FROM answers' src | grep -v '^src/core/rounds\.js:' || true)
  if [ -n "$bad" ]; then
    echo "only src/core/rounds.js may read the answers table:"
    echo "$bad"
    exit 1
  fi
  echo "layering ok"
else
  skip "no src/core directory yet"
fi

stage "6. script syntax"
if [ -d scripts ]; then
  for f in scripts/*.sh; do
    [ -e "$f" ] || continue
    bash -n "$f"
    echo "bash -n $f ok"
  done
  for f in scripts/*.mjs; do
    [ -e "$f" ] || continue
    node --check "$f"
    echo "node --check $f ok"
  done
else
  skip "no scripts directory"
fi

printf '\nverify: ok\n'
