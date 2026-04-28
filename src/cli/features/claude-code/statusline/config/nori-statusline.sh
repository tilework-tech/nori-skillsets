#!/bin/bash

# Nori Skillsets Status Line
# Displays git branch, session cost, token usage, and Nori branding

# Read JSON context from stdin
INPUT=$(cat)

# === CHECK FOR JQ DEPENDENCY ===
if ! command -v jq >/dev/null 2>&1; then
    # ANSI color codes
    YELLOW='\033[0;33m'
    NC='\033[0m'

    echo -e "${YELLOW}⚠️  Nori statusline requires jq. Install: brew install jq (macOS) or apt install jq (Linux)${NC}"
    echo -e "${YELLOW}Augmented with Nori${NC}"
    exit 0
fi

# === CONFIG FILE LOCATION ===
# Config is always at ~/.nori-config.json
INSTALL_DIR="$HOME"
CONFIG_FILE="$HOME/.nori-config.json"

# === INSTALLED PACKAGE LOCATION ===
# Substituted at install time by the statusline loader. The version we
# display and compare against the registry's "latest" must come from the
# actually-installed package.json so it tracks `npm install -g` upgrades
# even when ~/.nori-config.json hasn't been refreshed yet.
NORI_PACKAGE_ROOT="__NORI_PACKAGE_ROOT__"

# === SKILLSET ENRICHMENT ===
# Get skillset name from ~/.nori-config.json
SKILLSET_NAME=""  # default to empty (don't show if not set)

if [ -f "$CONFIG_FILE" ]; then
    # Read skillset from activeSkillset field
    SKILLSET_NAME=$(jq -r '.activeSkillset // ""' "$CONFIG_FILE" 2>/dev/null)
fi

# Prefer on-disk package.json; fall back to config when unavailable.
NORI_VERSION=""
if [ -n "$NORI_PACKAGE_ROOT" ] && [ -f "$NORI_PACKAGE_ROOT/package.json" ]; then
    NORI_VERSION=$(jq -r '.version // ""' "$NORI_PACKAGE_ROOT/package.json" 2>/dev/null)
fi
if [ -z "$NORI_VERSION" ] && [ -f "$CONFIG_FILE" ]; then
    NORI_VERSION=$(jq -r '.version // ""' "$CONFIG_FILE" 2>/dev/null)
fi

# Inject skillset into the JSON (can be empty string)
INPUT=$(echo "$INPUT" | jq --arg skillset "$SKILLSET_NAME" '. + {skillset_name: $skillset}')

# ANSI color codes
MAGENTA='\033[0;35m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[0;33m'
DIM_WHITE='\033[2;37m'
NC='\033[0m' # No Color

# Extract current working directory from JSON
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')

# Get git branch
BRANCH=""
if [ -n "$CWD" ] && [ -d "$CWD" ]; then
    BRANCH=$(cd "$CWD" && git branch --show-current 2>/dev/null)
fi

if [ -z "$BRANCH" ]; then
    BRANCH="no git"
fi

# === COST AND LINES (cumulative per process, no reset on /clear) ===
COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0')
COST_FORMATTED=$(printf "%.2f" "$COST")
LINES_ADDED=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0')
LINES_REMOVED=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0')

# === TOKEN TRACKING (cumulative across user session, including cached tokens) ===
# Deterministic session file based on cwd to avoid conflicts between projects
if command -v md5sum >/dev/null 2>&1; then
    SESSION_HASH=$(echo "$CWD" | md5sum | cut -d' ' -f1)
elif command -v md5 >/dev/null 2>&1; then
    SESSION_HASH=$(echo "$CWD" | md5 | cut -d' ' -f1)
else
    SESSION_HASH="default"
fi
SESSION_FILE="/tmp/nori-statusline-session-${SESSION_HASH}"

# Extract raw non-cached cumulative totals (used as "new API call" signal)
RAW_INPUT=$(echo "$INPUT" | jq -r '.context_window.total_input_tokens // 0')
RAW_OUTPUT=$(echo "$INPUT" | jq -r '.context_window.total_output_tokens // 0')
RAW_TOTAL=$((RAW_INPUT + RAW_OUTPUT))

# Extract per-call usage (includes cached tokens)
CALL_INPUT=$(echo "$INPUT" | jq -r '.context_window.current_usage.input_tokens // 0')
CALL_CACHE_READ=$(echo "$INPUT" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
CALL_CACHE_CREATE=$(echo "$INPUT" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
CALL_OUTPUT=$(echo "$INPUT" | jq -r '.context_window.current_usage.output_tokens // 0')
CALL_TOTAL=$((CALL_INPUT + CALL_CACHE_READ + CALL_CACHE_CREATE + CALL_OUTPUT))

# Read previous token tracking state
PREV_SESSION_ID=""
PREV_RAW_TOTAL="0"
ACCUMULATED_TOKENS="0"
PREV_RAW_COST="0"
if [ -f "$SESSION_FILE" ]; then
    PREV_SESSION_ID=$(sed -n '1p' "$SESSION_FILE" 2>/dev/null || echo "")
    PREV_RAW_TOTAL=$(sed -n '2p' "$SESSION_FILE" 2>/dev/null || echo "0")
    ACCUMULATED_TOKENS=$(sed -n '3p' "$SESSION_FILE" 2>/dev/null || echo "0")
    PREV_RAW_COST=$(sed -n '4p' "$SESSION_FILE" 2>/dev/null || echo "0")
fi

# Detect process restart: cost decreased from previous invocation
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
IS_RESTART="0"
if [ -n "$PREV_RAW_COST" ] && [ "$PREV_RAW_COST" != "0" ]; then
    IS_RESTART=$(jq -n --argjson a "$COST" --argjson b "$PREV_RAW_COST" 'if $a < $b then 1 else 0 end' 2>/dev/null || echo "0")
fi
if [ "$IS_RESTART" = "1" ]; then
    ACCUMULATED_TOKENS=0
    PREV_RAW_TOTAL=0
fi

# Detect /clear (session_id changed): reset raw tracking baseline
if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "$PREV_SESSION_ID" ]; then
    PREV_RAW_TOTAL=0
fi

# Detect new API call(s) and accumulate tokens
if [ "$RAW_TOTAL" -ne "$PREV_RAW_TOTAL" ] 2>/dev/null; then
    RAW_DELTA=$((RAW_TOTAL - PREV_RAW_TOTAL))
    CALL_NON_CACHED=$((CALL_INPUT + CALL_OUTPUT))
    EXTRA=0
    if [ "$RAW_DELTA" -gt "$CALL_NON_CACHED" ] && [ "$CALL_NON_CACHED" -gt 0 ]; then
        EXTRA=$((RAW_DELTA - CALL_NON_CACHED))
    fi
    ACCUMULATED_TOKENS=$((ACCUMULATED_TOKENS + CALL_TOTAL + EXTRA))
    PREV_RAW_TOTAL=$RAW_TOTAL
fi

TOTAL_TOKENS=$ACCUMULATED_TOKENS

# Save token tracking state
printf '%s\n%s\n%s\n%s\n' "$SESSION_ID" "$PREV_RAW_TOTAL" "$ACCUMULATED_TOKENS" "$COST" > "$SESSION_FILE" 2>/dev/null

# Context length from current_usage (most recent message's context size)
CONTEXT_LENGTH=$((CALL_INPUT + CALL_CACHE_READ + CALL_CACHE_CREATE))

# Format tokens (k for thousands, M for millions)
format_tokens() {
    local count=$1
    if [ "$count" -ge 1000000 ]; then
        echo "scale=1; $count / 1000000" | bc | sed 's/$/M/'
    elif [ "$count" -ge 1000 ]; then
        echo "scale=1; $count / 1000" | bc | sed 's/$/k/'
    else
        echo "$count"
    fi
}

TOKENS_FORMATTED=$(format_tokens "$TOTAL_TOKENS")
CONTEXT_FORMATTED=$(format_tokens "$CONTEXT_LENGTH")

LINES_FORMATTED="+${LINES_ADDED}/-${LINES_REMOVED}"

# Extract skillset name (passed from enrichment)
SKILLSET_NAME=$(echo "$INPUT" | jq -r '.skillset_name // ""')

# Build branding message
if [ -n "$NORI_VERSION" ]; then
    BRANDING="${YELLOW}Augmented with Nori v${NORI_VERSION} ${NC}"
else
    BRANDING="${YELLOW}Augmented with Nori ${NC}"
fi

# Single promotional tip
TIPS=(
    "Try the nori cli for the best agentic ai cli! Just run \`npm install -g nori-skillsets\`"
)

# Check for install-in-progress marker
INSTALL_MARKER="$INSTALL_DIR/.nori-install-in-progress"
if [ -f "$INSTALL_MARKER" ]; then
    # Install failed - read version from marker
    FAILED_VERSION=$(cat "$INSTALL_MARKER" 2>/dev/null || echo "unknown")

    # Check if marker is stale (>24 hours old)
    if [ "$(uname)" = "Darwin" ]; then
        # macOS date format
        MARKER_AGE_HOURS=$(( ($(date +%s) - $(stat -f %m "$INSTALL_MARKER")) / 3600 ))
    else
        # Linux date format
        MARKER_AGE_HOURS=$(( ($(date +%s) - $(stat -c %Y "$INSTALL_MARKER")) / 3600 ))
    fi

    if [ "$MARKER_AGE_HOURS" -gt 24 ]; then
        INSTALL_MESSAGE="⚠️  Nori install v${FAILED_VERSION} did not complete (marker is ${MARKER_AGE_HOURS}h old). Check /tmp/nori.log or remove marker: rm ${INSTALL_MARKER}"
    else
        INSTALL_MESSAGE="⚠️  Nori install v${FAILED_VERSION} did not complete. Check /tmp/nori.log for details."
    fi
    STATUS_TIP="${INSTALL_MESSAGE}"
else
    # Check for available updates from version cache
    VERSION_CACHE="$HOME/.nori/profiles/nori-skillsets-version.json"
    UPDATE_MESSAGE=""
    if [ -f "$VERSION_CACHE" ]; then
        LATEST_VERSION=$(jq -r '.latest_version // empty' "$VERSION_CACHE" 2>/dev/null)
        DISMISSED_VERSION=$(jq -r '.dismissed_version // empty' "$VERSION_CACHE" 2>/dev/null)
        if [ -n "$LATEST_VERSION" ] && [ -n "$NORI_VERSION" ] && [ "$LATEST_VERSION" != "$NORI_VERSION" ] && [ "$LATEST_VERSION" != "$DISMISSED_VERSION" ]; then
            # Compare versions: check if latest is newer than current
            # Strip -next.* suffix: -next versions are ahead of their base release
            CURRENT_SEMVER=$(echo "$NORI_VERSION" | sed 's/-next.*//')
            if [ -n "$CURRENT_SEMVER" ] && [ "$CURRENT_SEMVER" != "0.0.0" ]; then
                # Cross-platform version comparison using node (sort -V not available on macOS)
                IS_NEWER=$(node -e "const [a,b]=['$CURRENT_SEMVER','$LATEST_VERSION'].map(v=>v.split('.').map(Number));process.stdout.write(a[0]<b[0]||(a[0]===b[0]&&a[1]<b[1])||(a[0]===b[0]&&a[1]===b[1]&&a[2]<b[2])?'1':'0')" 2>/dev/null || echo "0")
                if [ "$IS_NEWER" = "1" ]; then
                    UPDATE_MESSAGE="🍙 Update available: ${NORI_VERSION} → ${LATEST_VERSION}. Run: npm install -g nori-skillsets@latest"
                fi
            fi
        fi
    fi

    if [ -n "$UPDATE_MESSAGE" ]; then
        STATUS_TIP="${YELLOW}${UPDATE_MESSAGE}${NC}"
    else
        # No install issues, no updates - show promotional tip
        SELECTED_TIP="${TIPS[0]}"
        STATUS_TIP="${DIM_WHITE}${SELECTED_TIP}${NC}"
    fi
fi

# Build status line with colors - split into three lines
# Line 1: Main metrics (git, [skillset if set], cost, tokens, context, lines)
if [ -n "$SKILLSET_NAME" ]; then
    echo -e "${MAGENTA}⎇ ${BRANCH}${NC} | ${YELLOW}Skillset: ${SKILLSET_NAME}${NC} | ${GREEN}Cost: \$${COST_FORMATTED}${NC} | ${CYAN}Tokens: ${TOKENS_FORMATTED}${NC} | Context: ${CONTEXT_FORMATTED} | Lines: ${LINES_FORMATTED}"
else
    echo -e "${MAGENTA}⎇ ${BRANCH}${NC} | ${GREEN}Cost: \$${COST_FORMATTED}${NC} | ${CYAN}Tokens: ${TOKENS_FORMATTED}${NC} | Context: ${CONTEXT_FORMATTED} | Lines: ${LINES_FORMATTED}"
fi
# Line 2: Branding
echo -e "${BRANDING}"
# Line 3: Status message (promotional tip or install error)
echo -e "${STATUS_TIP}"
