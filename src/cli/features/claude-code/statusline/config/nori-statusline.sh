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

# === SKILLSET ENRICHMENT ===
# Get skillset name from ~/.nori-config.json
SKILLSET_NAME=""  # default to empty (don't show if not set)

if [ -f "$CONFIG_FILE" ]; then
    # Read skillset from activeSkillset field
    SKILLSET_NAME=$(jq -r '.activeSkillset // ""' "$CONFIG_FILE" 2>/dev/null)

    # Read version from config
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

# === SESSION TRACKING FOR /clear RESET ===
# Track session_id to detect when /clear creates a new session
# When session changes, store baseline cost/lines so we can show deltas
SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

# Deterministic session file based on cwd to avoid conflicts between projects
if command -v md5sum >/dev/null 2>&1; then
    SESSION_HASH=$(echo "$CWD" | md5sum | cut -d' ' -f1)
elif command -v md5 >/dev/null 2>&1; then
    SESSION_HASH=$(echo "$CWD" | md5 | cut -d' ' -f1)
else
    SESSION_HASH="default"
fi
SESSION_FILE="/tmp/nori-statusline-session-${SESSION_HASH}"

# Read previous session state
PREV_SESSION_ID=""
BASELINE_COST="0"
BASELINE_LINES_ADDED="0"
BASELINE_LINES_REMOVED="0"
if [ -f "$SESSION_FILE" ]; then
    PREV_SESSION_ID=$(head -1 "$SESSION_FILE" 2>/dev/null)
    BASELINE_COST=$(sed -n '2p' "$SESSION_FILE" 2>/dev/null || echo "0")
    BASELINE_LINES_ADDED=$(sed -n '3p' "$SESSION_FILE" 2>/dev/null || echo "0")
    BASELINE_LINES_REMOVED=$(sed -n '4p' "$SESSION_FILE" 2>/dev/null || echo "0")
fi

# Extract raw cumulative values from stdin
RAW_COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0')
RAW_LINES_ADDED=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0')
RAW_LINES_REMOVED=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0')

# Detect session change and update baseline
if [ -n "$SESSION_ID" ] && [ "$SESSION_ID" != "$PREV_SESSION_ID" ]; then
    BASELINE_COST="$RAW_COST"
    BASELINE_LINES_ADDED="$RAW_LINES_ADDED"
    BASELINE_LINES_REMOVED="$RAW_LINES_REMOVED"
fi

# Save current session state
if [ -n "$SESSION_ID" ]; then
    printf '%s\n%s\n%s\n%s\n' "$SESSION_ID" "$BASELINE_COST" "$BASELINE_LINES_ADDED" "$BASELINE_LINES_REMOVED" > "$SESSION_FILE" 2>/dev/null
fi

# Calculate session-relative cost and lines (clamped to >= 0)
COST=$(echo "$RAW_COST - $BASELINE_COST" | bc 2>/dev/null || echo "0")
if echo "$COST < 0" | bc -l 2>/dev/null | grep -q '^1'; then
    COST="0"
fi
COST_FORMATTED=$(printf "%.2f" "$COST")
LINES_ADDED=$((RAW_LINES_ADDED - BASELINE_LINES_ADDED))
LINES_REMOVED=$((RAW_LINES_REMOVED - BASELINE_LINES_REMOVED))
if [ "$LINES_ADDED" -lt 0 ]; then LINES_ADDED=0; fi
if [ "$LINES_REMOVED" -lt 0 ]; then LINES_REMOVED=0; fi

# === TOKEN USAGE FROM CONTEXT WINDOW ===
# Use context_window fields from stdin JSON (resets properly on /clear)
TOTAL_INPUT_TOKENS=$(echo "$INPUT" | jq -r '.context_window.total_input_tokens // 0')
TOTAL_OUTPUT_TOKENS=$(echo "$INPUT" | jq -r '.context_window.total_output_tokens // 0')
TOTAL_TOKENS=$((TOTAL_INPUT_TOKENS + TOTAL_OUTPUT_TOKENS))

# Context length from current_usage (most recent message's context size)
CONTEXT_LENGTH=$(echo "$INPUT" | jq -r '
    ((.context_window.current_usage.input_tokens // 0) +
     (.context_window.current_usage.cache_read_input_tokens // 0) +
     (.context_window.current_usage.cache_creation_input_tokens // 0))' 2>/dev/null)

if [ -z "$CONTEXT_LENGTH" ] || [ "$CONTEXT_LENGTH" = "null" ]; then
    CONTEXT_LENGTH=0
fi


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
