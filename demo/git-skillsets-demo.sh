#!/usr/bin/env bash
#
# Milestone 1 demo — Git-backed skillsets, end to end, with no Registrar.
#
# Tells the story of the git-backed-skillsets milestone: create, publish,
# install (via a configured primary remote), pin, update, fork, and manage
# durable trust — all over Git.
#
# Self-contained by default: it stands up a local bare Git "remote" and two
# isolated Nori homes (an author and a consumer), so it runs anywhere with no
# credentials and is fully repeatable.
#
# Usage:
#   demo/git-skillsets-demo.sh            # interactive: press Enter between steps
#   demo/git-skillsets-demo.sh --auto     # hands-off (sleeps), good for recording
#   demo/git-skillsets-demo.sh --remote ssh://git@host/org/repo.git   # real remote
#
set -euo pipefail

# --- options -----------------------------------------------------------------
AUTO=0
REMOTE_OVERRIDE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --auto) AUTO=1 ;;
    --remote) REMOTE_OVERRIDE="$2"; shift ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
  shift
done

# --- locate repo + CLI -------------------------------------------------------
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKS="$REPO/build/src/cli/nori-skillsets.js"
if [ ! -f "$SKS" ]; then
  echo "The CLI is not built. Run 'npm run build' in $REPO first." >&2
  exit 1
fi

# --- presentation helpers ----------------------------------------------------
BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[36m'; GREEN=$'\033[32m'; RESET=$'\033[0m'
STEP=0
banner() {
  STEP=$((STEP + 1))
  printf '\n%s══ %02d. %s ══%s\n' "$BOLD$CYAN" "$STEP" "$1" "$RESET"
  [ -n "${2:-}" ] && printf '%s%s%s\n' "$DIM" "$2" "$RESET"
}
pause() {
  if [ "$AUTO" = "1" ]; then sleep "${1:-2}"; else
    printf '%s   … press Enter …%s' "$DIM" "$RESET"; read -r _; fi
}
# Echo a command, then run it (in the given Nori home).
show() { printf '   %s$ %s%s\n' "$GREEN" "$*" "$RESET"; }
sks() { local home="$1"; shift; show "NORI_GLOBAL_CONFIG=<$home> sks $*"; env NORI_GLOBAL_CONFIG="$WORK/$home" node "$SKS" "$@"; }
git_q() { git "$@" >/dev/null 2>&1; }

# --- workspace ---------------------------------------------------------------
WORK="$(mktemp -d)"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
git config --global user.email >/dev/null 2>&1 || git config --global user.email "demo@nori.local"
git config --global user.name  >/dev/null 2>&1 || git config --global user.name  "Nori Demo"

if [ -n "$REMOTE_OVERRIDE" ]; then REMOTE="$REMOTE_OVERRIDE"; else
  git init --bare -q "$WORK/remote.git"; REMOTE="file://$WORK/remote.git"; fi
SLUG="senior-swe"
AUTHOR_PROFILE="$WORK/author/.nori/profiles/personal/$SLUG"

printf '%s\n' "$BOLD"
cat <<'EOF'
  ┌────────────────────────────────────────────────────────────┐
  │  Nori skillsets over Git — no Registrar, no login, all Git  │
  └────────────────────────────────────────────────────────────┘
EOF
printf '%s' "$RESET"
echo "  Remote:   $REMOTE"
echo "  Author:   \$WORK/author     Consumer: \$WORK/consumer"
pause 1

# 1. CREATE ------------------------------------------------------------------
banner "Author creates a Git-native skillset" \
  "'new' scaffolds an offline, editable Git repo — no network, no Registrar."
sks author new "$SLUG"
mkdir -p "$AUTHOR_PROFILE/skills"
printf '# Review checklist\n\n- Prefer clarity over cleverness.\n' > "$AUTHOR_PROFILE/skills/review.md"
show "cat author profile nori.json"; cat "$AUTHOR_PROFILE/nori.json"; echo
pause

# 2. PUBLISH -----------------------------------------------------------------
banner "Author publishes it to a Git remote" \
  "'publish' commits the reviewed tree and pushes skillsets/$SLUG — deliberate, fast-forward-only."
sks author publish "$SLUG" --to "$REMOTE" --yes
show "git ls-remote $REMOTE skillsets/$SLUG"
git ls-remote "$REMOTE" "refs/heads/skillsets/$SLUG"
TIP1="$(git ls-remote "$REMOTE" "refs/heads/skillsets/$SLUG" | cut -f1)"
pause

# 3. INSTALL (via primary remote) --------------------------------------------
banner "Consumer points its primary remote at that Git repo" \
  "Now bare-name installs resolve to Git instead of the Registry."
sks consumer config --primary-remote "$REMOTE"
banner "Consumer installs by bare name — from Git" \
  "First install of a source prompts for trust; --trust-source approves non-interactively and records durable trust."
sks consumer install "$SLUG" --trust-source --non-interactive
show "sks trust list"; sks consumer trust list
pause

# 4. PIN ---------------------------------------------------------------------
banner "A different home pins an exact commit" \
  "'--pin <sha>' gives a reproducible historical version (detached HEAD)."
sks pin install "$SLUG" --from "$REMOTE" --pin "$TIP1" --trust-source --non-interactive
PIN_HEAD="$(git -C "$WORK/pin/.nori/profiles/personal/$SLUG" rev-parse HEAD)"
echo "   pinned HEAD = $PIN_HEAD  (matches published tip: $TIP1)"
pause

# 5. UPDATE ------------------------------------------------------------------
banner "Author ships an update" \
  "Edit the skillset and publish again — the branch advances by one commit."
printf -- '- Write tests before implementation.\n' >> "$AUTHOR_PROFILE/skills/review.md"
sks author publish "$SLUG" --to "$REMOTE" --yes
TIP2="$(git ls-remote "$REMOTE" "refs/heads/skillsets/$SLUG" | cut -f1)"
banner "Consumer updates — fast-forward only, transactional" \
  "'update' fetches, fast-forwards, and re-activates atomically (rolls back on any failure)."
sks consumer update "$SLUG"
UPDATED_HEAD="$(git -C "$WORK/consumer/.nori/profiles/personal/$SLUG" rev-parse HEAD)"
echo "   consumer HEAD = $UPDATED_HEAD  (matches new tip: $TIP2)"
show "consumer now has the new content:"; tail -1 "$WORK/consumer/.nori/profiles/personal/$SLUG/skills/review.md"
pause

# 6. FORK --------------------------------------------------------------------
banner "Consumer forks it into their own skillset" \
  "'fork' makes an independent copy — no upstream history, ready to diverge and publish."
sks consumer fork "personal/$SLUG" "${SLUG}-mine"
sks consumer publish "${SLUG}-mine" --to "$REMOTE" --yes
show "git ls-remote $REMOTE skillsets/${SLUG}-mine"
git ls-remote "$REMOTE" "refs/heads/skillsets/${SLUG}-mine"
pause

# 7. TRUST -------------------------------------------------------------------
banner "Durable trust is revocable" \
  "Revoke a source and the next install of it re-prompts."
show "sks trust list"; sks consumer trust list
sks consumer trust revoke "$REMOTE" "$SLUG"
show "sks trust list  (after revoke)"; sks consumer trust list
pause 1

printf '\n%s  ✔ Milestone 1: create → publish → install → pin → update → fork → trust — all over Git, no Registrar.%s\n\n' "$BOLD$GREEN" "$RESET"
