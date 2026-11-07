#!/usr/bin/env bash
# Privacy check on every commit in a range: the files each commit adds or changes, as that commit
# holds them, so something added in one commit and removed in a later one is still found, and the
# commit's message, read through the same rules by scripts/privacy-check.ts.
#
# A file finding prints under `commit <sha>:` as `file:line label`; a message finding prints as
# `commit <sha> message <label>`, once per label. Neither prints the text that matched. Under
# --no-gitleaks the last line printed is `gitleaks did not run`.
#
# Usage: bash scripts/privacy-history.sh <range> [--denylist <file>] [--no-gitleaks]
#   <range> such as origin/main..HEAD, or HEAD for all; PRIVACY_DENYLIST=<file> names a denylist
#   too, and --denylist wins over it.
# Exit: 0 nothing found, 1 findings, 2 a scan could not run.
#
# Ported from the service repository's scripts/privacy-history.sh, adding the message scan, the
# --denylist and --no-gitleaks flags, and the check found beside this file rather than at the root
# of the repository scanned.
set -euo pipefail

usage='usage: privacy-history.sh <range> [--denylist <file>] [--no-gitleaks]'
skipped='gitleaks did not run'
if [ $# -lt 1 ] || [ -z "$1" ]; then echo "$usage" >&2; exit 2; fi
range="$1"
shift

denylist=()
if [ -n "${PRIVACY_DENYLIST:-}" ]; then denylist=(--denylist "$PRIVACY_DENYLIST"); fi
gitleaks=()
while [ $# -gt 0 ]; do
  case "$1" in
    --denylist)
      if [ -z "${2:-}" ]; then echo "$usage" >&2; exit 2; fi
      denylist=(--denylist "$2")
      shift 2
      ;;
    --no-gitleaks)
      gitleaks=(--no-gitleaks)
      shift
      ;;
    *) echo "$usage" >&2; exit 2 ;;
  esac
done

check="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/privacy-check.ts"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
status=0

# Prints the closing line under --no-gitleaks, then exits with the status given.
finish() {
  if [ ${#gitleaks[@]} -gt 0 ]; then echo "$skipped"; fi
  exit "$1"
}

# Raises the run's status for a scan that exited with $1: 2 stays 2, any other failure is 1.
note() {
  if [ "$1" -eq 2 ] || [ "$status" -eq 2 ]; then status=2; else status=1; fi
}

# The check over one folder, its output on stdout, without its own `gitleaks did not run` line.
scan() {
  PRIVACY_DENYLIST='' bun "$check" "$@" ${denylist[@]+"${denylist[@]}"} \
    ${gitleaks[@]+"${gitleaks[@]}"} 2>&1
}

without_skipped() {
  local line
  while IFS= read -r line; do
    if [ "$line" != "$skipped" ]; then printf '%s\n' "$line"; fi
  done <<< "$1"
}

# The files the commit adds or changes, as it holds them, scanned as one folder.
scan_files() {
  local commit="$1" files="$work/files-$1" result=0 out
  mkdir -p "$files"
  git diff-tree --root --no-commit-id --name-only -r --diff-filter=ACMRT -z "$commit" |
    while IFS= read -r -d '' file; do
      mkdir -p "$files/$(dirname "$file")"
      git show "$commit:$file" > "$files/$file"
    done
  local args=("$files")
  if git cat-file -e "$commit:.privacy-reviewed" 2>/dev/null; then
    git show "$commit:.privacy-reviewed" > "$work/reviewed-$commit"
    args+=(--reviewed "$work/reviewed-$commit")
  fi
  out="$(scan "${args[@]}")" || result=$?
  if [ "$result" -ne 0 ]; then
    echo "commit ${commit:0:12}:"
    without_skipped "$out"
    note "$result"
  fi
}

# The commit's message, written to a file alone in a folder and scanned there; each finding is
# printed as the message's, once per label, and a scan that could not run prints its error.
scan_message() {
  local commit="$1" folder="$work/message-$1" result=0 out line
  mkdir -p "$folder"
  git log -1 --format=%B "$commit" > "$folder/message"
  out="$(scan "$folder")" || result=$?
  if [ "$result" -eq 0 ]; then return; fi
  note "$result"
  if [ "$result" -ne 1 ]; then
    echo "commit ${commit:0:12} message:"
    without_skipped "$out"
    return
  fi
  while IFS= read -r line; do
    case "$line" in
      message:*' '*) echo "commit ${commit:0:12} message ${line#* }" ;;
    esac
  done <<< "$out" | sort -u
}

if ! commits="$(git rev-list --reverse "$range")"; then
  echo "scan could not run: git rev-list failed for the range given" >&2
  finish 2
fi
for commit in $commits; do
  scan_files "$commit"
  scan_message "$commit"
done
finish "$status"
