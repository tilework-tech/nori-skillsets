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
CLEANUP=0
while [ $# -gt 0 ]; do
  case "$1" in
    --auto) AUTO=1 ;;
    --remote) REMOTE_OVERRIDE="$2"; shift ;;
    --cleanup) CLEANUP=1 ;;
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
persona() {
  case "$1" in
    author)   echo "Alice · author" ;;
    consumer) echo "Bob · you" ;;
    pin)      echo "Carol · reproducible install" ;;
    *)        echo "$1" ;;
  esac
}
# Each home is a separate machine/persona; show who is running the command.
sks() { local home="$1"; shift; show "[$(persona "$home")]  sks $*"; env NORI_GLOBAL_CONFIG="$WORK/$home" node "$SKS" "$@"; }
git_q() { git "$@" >/dev/null 2>&1; }

# --- workspace ---------------------------------------------------------------
WORK="$(mktemp -d)"
REMOTE_BRANCHES=()   # branches this run pushed to a real --remote
cleanup() {
  rm -rf "$WORK"
  if [ "$CLEANUP" = "1" ] && [ -n "$REMOTE_OVERRIDE" ] && [ "${#REMOTE_BRANCHES[@]}" -gt 0 ]; then
    echo; echo "── cleanup: removing demo branches from the remote ──"
    for b in "${REMOTE_BRANCHES[@]}"; do
      git push -q "$REMOTE" --delete "$b" 2>/dev/null \
        && echo "  deleted $b" || echo "  (already gone) $b"
    done
  fi
}
# Also clean up on Ctrl-C / disconnect (e.g. the web-terminal tab closing).
trap cleanup EXIT INT TERM HUP
git config --global user.email >/dev/null 2>&1 || git config --global user.email "demo@nori.local"
git config --global user.name  >/dev/null 2>&1 || git config --global user.name  "Nori Demo"

if [ -n "$REMOTE_OVERRIDE" ]; then REMOTE="$REMOTE_OVERRIDE"; else
  git init --bare -q "$WORK/remote.git"; REMOTE="file://$WORK/remote.git"; fi
SLUG="code-reviewer"
AUTHOR_PROFILE="$WORK/author/.nori/profiles/personal/$SLUG"

printf '%s\n' "$BOLD"
cat <<'EOF'
  ┌────────────────────────────────────────────────────────────┐
  │  Nori skillsets over Git — no Registrar, no login, all Git  │
  └────────────────────────────────────────────────────────────┘
EOF
printf '%s' "$RESET"
echo "  Remote:  $REMOTE"
echo "  Cast:    Alice (author) publishes a skillset · Bob (you) installs & evolves it"
echo "           — two separate machines, only Git between them."
pause 1

# 1. CREATE ------------------------------------------------------------------
banner "Alice authors a Git-native skillset" \
  "'new' scaffolds an offline, editable Git repo — no network, no Registrar."
sks author new "$SLUG"
mkdir -p "$AUTHOR_PROFILE/skills"
printf '# Review checklist\n\n- Prefer clarity over cleverness.\n' > "$AUTHOR_PROFILE/skills/review.md"
show "cat Alice's nori.json"; cat "$AUTHOR_PROFILE/nori.json"; echo
pause

# 2. PUBLISH -----------------------------------------------------------------
banner "Alice publishes it to a Git remote" \
  "'publish' commits the reviewed tree and pushes skillsets/$SLUG — deliberate, fast-forward-only."
sks author publish "$SLUG" --to "$REMOTE" --yes
show "git ls-remote $REMOTE skillsets/$SLUG"
git ls-remote "$REMOTE" "refs/heads/skillsets/$SLUG"
TIP1="$(git ls-remote "$REMOTE" "refs/heads/skillsets/$SLUG" | cut -f1)"
REMOTE_BRANCHES+=("skillsets/$SLUG")
pause

# 3. INSTALL (via primary remote) --------------------------------------------
banner "Bob points his primary remote at Alice's repo" \
  "Now bare-name installs resolve to Git instead of the Registry."
sks consumer config --primary-remote "$REMOTE"
# #1 — prove there is no Registrar in the loop: Bob's only configured source is a
# Git remote. No 'sks login' is ever run and no Registry credentials exist.
show "Bob's entire Nori config — just a Git remote, no login, no Registry credentials:"
cat "$WORK/consumer/.nori-config.json"; echo
# 'list' exits non-zero when empty; that's fine for the before/after reveal.
show "Bob has no skillsets yet:"; sks consumer list || true
pause
banner "Bob installs Alice's skillset — trust is a real gate" \
  "An unknown Git source must be approved before Nori will use its code."
show "no approval (non-interactive, no --trust-source) → the source is refused:"
sks consumer install "$SLUG" --non-interactive || true
show "Bob approves the source with --trust-source — which records durable trust:"
sks consumer install "$SLUG" --trust-source --non-interactive
show "now Bob has Alice's skillset:"; sks consumer list || true
show "sks trust list"; sks consumer trust list
pause

# 4. PIN ---------------------------------------------------------------------
banner "Carol pins an exact commit — a frozen version" \
  "On a third machine, '--pin <sha>' installs one exact commit and detaches HEAD. It will NOT move, even when Alice advances the branch (we'll see that shortly)."
sks pin install "$SLUG" --from "$REMOTE" --pin "$TIP1" --trust-source --non-interactive
PIN_HEAD="$(git -C "$WORK/pin/.nori/profiles/personal/$SLUG" rev-parse HEAD)"
echo "   Carol is pinned to $PIN_HEAD  (today's tip — remember this SHA)"
pause

# 5. UPDATE ------------------------------------------------------------------
banner "Alice ships an update" \
  "She edits the skillset and publishes again — the branch advances by one commit."
printf -- '- Write tests before implementation.\n' >> "$AUTHOR_PROFILE/skills/review.md"
sks author publish "$SLUG" --to "$REMOTE" --yes
TIP2="$(git ls-remote "$REMOTE" "refs/heads/skillsets/$SLUG" | cut -f1)"
pause
banner "Bob updates — fast-forward only, transactional" \
  "'update' fetches, fast-forwards, and re-activates atomically (rolls back on any failure)."
sks consumer update "$SLUG"
UPDATED_HEAD="$(git -C "$WORK/consumer/.nori/profiles/personal/$SLUG" rev-parse HEAD)"
echo "   Bob's HEAD = $UPDATED_HEAD  (matches Alice's new tip: $TIP2)"
show "Bob now has Alice's new content:"; tail -1 "$WORK/consumer/.nori/profiles/personal/$SLUG/skills/review.md"
pause

# 5b. PIN CONTRAST -----------------------------------------------------------
banner "Meanwhile, Carol's pin is frozen" \
  "Bob followed Alice's update to the new tip; Carol's pinned install did NOT move — and 'update' refuses to advance a pin (pins are immutable)."
echo "   Bob   (following) → $UPDATED_HEAD   ← advanced to Alice's new tip"
echo "   Carol (pinned)    → $PIN_HEAD   ← unchanged: still the original commit"
show "even 'update' won't move Carol's pin:"
sks pin update "$SLUG" --non-interactive || true
pause

# 6. FORK --------------------------------------------------------------------
banner "Bob forks it into his own skillset" \
  "'fork' makes an independent copy — no upstream history, ready to diverge and publish."
sks consumer fork "personal/$SLUG" "${SLUG}-mine"
sks consumer publish "${SLUG}-mine" --to "$REMOTE" --yes
REMOTE_BRANCHES+=("skillsets/${SLUG}-mine")
show "git ls-remote $REMOTE skillsets/${SLUG}-mine"
git ls-remote "$REMOTE" "refs/heads/skillsets/${SLUG}-mine"
pause

# 7. TRUST -------------------------------------------------------------------
banner "Bob's trust is durable and revocable" \
  "Revoke a source and the next install of it re-prompts."
show "sks trust list"; sks consumer trust list
sks consumer trust revoke "$REMOTE" "$SLUG"
show "sks trust list  (after revoke)"; sks consumer trust list
pause
# #2 — revoke has teeth: installing that source again is gated once more.
banner "Revoked trust re-gates the source" \
  "With trust gone, installing from that source is refused once more."
show "trust is gone → installing from that source is refused again:"
sks consumer install "$SLUG" --non-interactive || true
pause 1

printf '\n%s  ✔ Milestone 1: create → publish → install → pin → update → fork → trust — all over Git, no Registrar.%s\n\n' "$BOLD$GREEN" "$RESET"
