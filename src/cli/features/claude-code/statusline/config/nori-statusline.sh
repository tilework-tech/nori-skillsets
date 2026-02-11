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
    echo -e "${YELLOW}Augmented with Nori __VERSION__${NC}"
    exit 0
fi

# === FIND INSTALL DIRECTORY ===
# Search upward from CWD to find .nori-config.json
find_install_dir() {
    local current_dir="$1"
    local max_depth=50
    local depth=0

    while [ "$depth" -lt "$max_depth" ]; do
        # Check for new-style config
        if [ -f "$current_dir/.nori-config.json" ]; then
            echo "$current_dir"
            return 0
        fi

        # Check for legacy config
        if [ -f "$current_dir/nori-config.json" ]; then
            echo "$current_dir"
            return 0
        fi

        # Check if we've reached root
        local parent_dir="$(dirname "$current_dir")"
        if [ "$parent_dir" = "$current_dir" ]; then
            break
        fi

        current_dir="$parent_dir"
        depth=$((depth + 1))
    done

    return 1
}

# Extract CWD from JSON input
CWD_FROM_JSON=$(echo "$INPUT" | jq -r '.cwd // empty')

# Find install directory by searching upward from CWD
if [ -n "$CWD_FROM_JSON" ] && [ -d "$CWD_FROM_JSON" ]; then
    INSTALL_DIR=$(find_install_dir "$CWD_FROM_JSON")
fi

# If we still don't have an install dir, use CWD as fallback
if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR="${CWD_FROM_JSON:-$(pwd)}"
fi

# === CONFIG FILE LOCATION ===
CONFIG_FILE="$INSTALL_DIR/.nori-config.json"

# === PROFILE ENRICHMENT ===
# Get profile name from ~/nori-config.json
PROFILE_NAME=""  # default to empty (don't show if not set)

if [ -f "$CONFIG_FILE" ]; then
    # Read profile from agents.claude-code first (new format), fall back to legacy profile
    PROFILE_NAME=$(jq -r '.agents["claude-code"].profile.baseProfile // .profile.baseProfile // ""' "$CONFIG_FILE" 2>/dev/null)
fi

# Inject profile into the JSON (can be empty string)
INPUT=$(echo "$INPUT" | jq --arg profile "$PROFILE_NAME" '. + {profile_name: $profile}')

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

# Extract session cost
COST=$(echo "$INPUT" | jq -r '.cost.total_cost_usd // 0')
COST_FORMATTED=$(printf "%.2f" "$COST")

# Extract transcript path for token parsing
TRANSCRIPT_PATH=$(echo "$INPUT" | jq -r '.transcript_path // empty')

# Parse transcript file to calculate actual token usage
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
    # Regular input tokens (not cached)
    INPUT_TOKENS=$(jq -r 'select(.message.usage != null) | .message.usage.input_tokens // 0' "$TRANSCRIPT_PATH" 2>/dev/null | awk '{sum+=$1} END {print sum+0}')

    # Cache creation tokens (charged at full input token rate)
    CACHE_CREATION_TOKENS=$(jq -r 'select(.message.usage != null) | .message.usage.cache_creation_input_tokens // 0' "$TRANSCRIPT_PATH" 2>/dev/null | awk '{sum+=$1} END {print sum+0}')

    # Cache read tokens (charged at ~10% of input token rate)
    CACHE_READ_TOKENS=$(jq -r 'select(.message.usage != null) | .message.usage.cache_read_input_tokens // 0' "$TRANSCRIPT_PATH" 2>/dev/null | awk '{sum+=$1} END {print sum+0}')

    # Output tokens
    OUTPUT_TOKENS=$(jq -r 'select(.message.usage != null) | .message.usage.output_tokens // 0' "$TRANSCRIPT_PATH" 2>/dev/null | awk '{sum+=$1} END {print sum+0}')

    # Context length: get most recent main chain entry's input token count (matches ccstatusline)
    # Context length = input_tokens + cache_read + cache_creation from the MOST RECENT message
    CONTEXT_LENGTH=$(jq -r 'select(.message.usage != null and .isSidechain != true and .isApiErrorMessage != true) |
        (.message.usage.input_tokens // 0) +
        (.message.usage.cache_read_input_tokens // 0) +
        (.message.usage.cache_creation_input_tokens // 0)' "$TRANSCRIPT_PATH" 2>/dev/null |
        tail -1)

    # Default to 0 if no valid context length found
    if [ -z "$CONTEXT_LENGTH" ]; then
        CONTEXT_LENGTH=0
    fi
else
    INPUT_TOKENS=0
    CACHE_CREATION_TOKENS=0
    CACHE_READ_TOKENS=0
    OUTPUT_TOKENS=0
    CONTEXT_LENGTH=0
fi

# Calculate total tokens (raw count)
TOTAL_TOKENS=$((INPUT_TOKENS + CACHE_CREATION_TOKENS + CACHE_READ_TOKENS + OUTPUT_TOKENS))


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

# Extract lines added/removed
LINES_ADDED=$(echo "$INPUT" | jq -r '.cost.total_lines_added // 0')
LINES_REMOVED=$(echo "$INPUT" | jq -r '.cost.total_lines_removed // 0')
LINES_FORMATTED="+${LINES_ADDED}/-${LINES_REMOVED}"

# Extract profile name (passed from enrichment)
PROFILE_NAME=$(echo "$INPUT" | jq -r '.profile_name // ""')

# Build branding message
BRANDING="${YELLOW}Augmented with Nori __VERSION__ ${NC}"

# Single promotional tip
TIPS=(
    "Try the nori cli for the best agentic ai cli! Just run \`npm install -g nori-ai-cli\`"
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
        if [ -n "$LATEST_VERSION" ] && [ "$LATEST_VERSION" != "__VERSION__" ] && [ "$LATEST_VERSION" != "$DISMISSED_VERSION" ]; then
            # Compare versions: check if latest is newer than current
            CURRENT_SEMVER="__VERSION__"
            if [ -n "$CURRENT_SEMVER" ] && [ "$CURRENT_SEMVER" != "0.0.0" ]; then
                # Cross-platform version comparison using node (sort -V not available on macOS)
                IS_NEWER=$(node -e "const [a,b]=['$CURRENT_SEMVER','$LATEST_VERSION'].map(v=>v.split('.').map(Number));process.stdout.write(a[0]<b[0]||(a[0]===b[0]&&a[1]<b[1])||(a[0]===b[0]&&a[1]===b[1]&&a[2]<b[2])?'1':'0')" 2>/dev/null || echo "0")
                if [ "$IS_NEWER" = "1" ]; then
                    UPDATE_MESSAGE="🍙 Update available: ${CURRENT_SEMVER} → ${LATEST_VERSION}. Run: npm install -g nori-skillsets@latest"
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
if [ -n "$PROFILE_NAME" ]; then
    echo -e "${MAGENTA}⎇ ${BRANCH}${NC} | ${YELLOW}Skillset: ${PROFILE_NAME}${NC} | ${GREEN}Cost: \$${COST_FORMATTED}${NC} | ${CYAN}Tokens: ${TOKENS_FORMATTED}${NC} | Context: ${CONTEXT_FORMATTED} | Lines: ${LINES_FORMATTED}"
else
    echo -e "${MAGENTA}⎇ ${BRANCH}${NC} | ${GREEN}Cost: \$${COST_FORMATTED}${NC} | ${CYAN}Tokens: ${TOKENS_FORMATTED}${NC} | Context: ${CONTEXT_FORMATTED} | Lines: ${LINES_FORMATTED}"
fi
# Line 2: Branding
echo -e "${BRANDING}"
# Line 3: Status message (promotional tip or install error)
echo -e "${STATUS_TIP}"
