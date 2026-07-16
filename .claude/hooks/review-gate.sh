#!/usr/bin/env bash
# Gates ticket-completion commands (git commit / gh issue close) on a fresh code review.
#
#   check  — PreToolUse hook. Reads the tool payload on stdin. Exit 2 blocks the tool.
#   mark   — records the current source state as reviewed.
#   status — prints whether the current source state is reviewed (for humans).
#
# Only source changes count: docs, ADRs, and build-steps never trigger the gate.

set -uo pipefail

# Trailing /** is required: a git pathspec containing a wildcard is matched against the
# whole path, so 'apps/*/src' matches nothing under apps/api/src/.
SOURCE_PATHS=('apps/*/src/**' 'packages/*/src/**' 'apps/*/test/**' 'apps/*/prisma/**')
MARKER_REL=".claude/.review-marker"
EMPTY_SHA="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

repo_root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$repo_root" || exit 0
MARKER="$repo_root/$MARKER_REL"

fingerprint() {
  {
    git diff HEAD -- "${SOURCE_PATHS[@]}"
    git ls-files --others --exclude-standard -- "${SOURCE_PATHS[@]}" |
      while IFS= read -r f; do
        printf '### %s\n' "$f"
        cat -- "$f" 2>/dev/null
      done
  } 2>/dev/null | shasum -a 256 | cut -d' ' -f1
}

case "${1:-check}" in
  mark)
    fingerprint > "$MARKER"
    echo "Recorded current source state as reviewed."
    ;;

  status)
    current=$(fingerprint)
    if [ "$current" = "$EMPTY_SHA" ]; then
      echo "No uncommitted source changes — gate is open."
    elif [ -f "$MARKER" ] && [ "$current" = "$(cat "$MARKER")" ]; then
      echo "Current source state has been reviewed — gate is open."
    else
      echo "Source changed since the last review — gate is closed."
    fi
    ;;

  check)
    payload=$(cat)
    cmd=$(node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(String(JSON.parse(d)?.tool_input?.command??""))}catch{process.stdout.write("")}})' <<<"$payload" 2>/dev/null)

    # Only gate the two commands that mean "this ticket is done", and only where they are
    # actually being invoked — at the start of the command or after a shell separator. A
    # command that merely mentions them (grep, echo, a heredoc) must pass through.
    if ! [[ "$cmd" =~ (^|[;&|]|[[:space:]]and[[:space:]])[[:space:]]*(git[[:space:]]+commit|gh[[:space:]]+issue[[:space:]]+close)([[:space:]]|$) ]]; then
      exit 0
    fi

    current=$(fingerprint)

    # Nothing changed under source — a docs/ADR-only commit needs no review.
    [ "$current" = "$EMPTY_SHA" ] && exit 0

    # Already reviewed at exactly this state.
    if [ -f "$MARKER" ] && [ "$current" = "$(cat "$MARKER")" ]; then
      exit 0
    fi

    cat >&2 <<'MSG'
BLOCKED: source has changed since the last code review.

Before closing a ticket or committing, run the strict reviewer against this diff:

    Agent(subagent_type="code-reviewer",
          prompt="Review the current uncommitted changes in this repo.")

Act on anything it rates BLOCKER or MAJOR, then record the review and retry:

    .claude/hooks/review-gate.sh mark

Only source counts (apps/*/src, apps/*/test, apps/*/prisma, packages/*/src) — docs-only
and build-steps changes never trigger this gate. Check state any time with:

    .claude/hooks/review-gate.sh status
MSG
    exit 2
    ;;

  *)
    echo "usage: review-gate.sh [check|mark|status]" >&2
    exit 1
    ;;
esac
