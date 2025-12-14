#!/bin/bash

# Nori Profiles Status Line
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

# === CONFIG TIER ENRICHMENT ===
# Get config tier from install directory config
CONFIG_TIER="unknown"
CONFIG_FILE="$INSTALL_DIR/.nori-config.json"

if [ -f "$CONFIG_FILE" ]; then
    # Check if auth credentials exist in config
    # Support both nested auth format (v19+) and legacy flat format
    HAS_AUTH=$(jq -r '
      if (.auth.username != null and (.auth.password != null or .auth.refreshToken != null) and .auth.organizationUrl != null) then "true"
      elif (.username != null and (.password != null or .refreshToken != null) and .organizationUrl != null) then "true"
      else "false" end
    ' "$CONFIG_FILE" 2>/dev/null)

    if [ "$HAS_AUTH" = "true" ]; then
        CONFIG_TIER="paid"
    else
        CONFIG_TIER="free"
    fi
else
    CONFIG_TIER="free"
fi

# Inject config_tier into the JSON
INPUT=$(echo "$INPUT" | jq --arg tier "$CONFIG_TIER" '. + {config_tier: $tier}')

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

# Extract config tier (passed from installer)
CONFIG_TIER=$(echo "$INPUT" | jq -r '.config_tier // "unknown"')

# Extract profile name (passed from enrichment)
PROFILE_NAME=$(echo "$INPUT" | jq -r '.profile_name // ""')

# Build branding message with upgrade link for free tier
if [ "$CONFIG_TIER" = "free" ]; then
    # OSC 8 hyperlink format: \033]8;;URL\033\\TEXT\033]8;;\033\\
    BRANDING="${YELLOW}Augmented with Nori __VERSION__ (\033]8;;https://tilework.tech\033\\upgrade\033]8;;\033\\)${NC}"
else
    BRANDING="${YELLOW}Augmented with Nori __VERSION__ ${NC}"
fi

# Array of rotating tips about Nori features
TIPS=(
    "Nori Tip: Use the webapp-testing skill to write Playwright tests for your web UIs"
    "Nori Tip: You can tell Nori to run any skill by name. Just ask Nori what skills it has"
    "Nori Tip: Want to learn more about Nori? Run /nori-info"
    "Nori Tip: Use the building-ui-ux skill to speed up your UI/UX iteration process"
    "Nori Tip: Nori can write PRs and get review using the github CLI"
    "Nori Tip: Run /nori-init-docs to create docs. Nori keeps them updated."
    "Nori Tip: Want to skip the standard flow? Just tell Nori to skip the checklist"
    "Nori Tip: Try running Nori in parallel with git worktrees and multiple sessions"
    "Nori Tip: Leverage your whole team's knowledge with the paid Nori server"
    "Nori Tip: Keep an eye on your total context usage. Start new conversations regularly!"
    "Nori Tip: Agents love tests! Use Nori's built-in Test Driven Development to never have a regression."
    "Nori Tip: Switch workflows with /nori-switch-profile - try documenter, senior-swe, or product-manager"
    "Nori Tip: Use /sync-noridocs to bulk upload all your local docs.md files to the server (paid)"
    "Nori Tip: The nori-change-documenter subagent automatically updates docs when you make code changes"
    "Nori Tip: Use the systematic-debugging skill when bugs occur - it ensures root cause analysis"
    "Nori Tip: The root-cause-tracing skill helps trace errors backward through the call stack"
    "Nori Tip: Try using the webapp-testing skill to debug UI/UX failures"
    "Nori Tip: Create custom profiles with /nori-create-profile - clone and customize to your workflow"
    "Nori Tip: Nori can take screenshots - ask it to analyze your screen for visual UI debugging"
    "Nori Tip: Get automated code review before PRs with the nori-code-reviewer subagent"
    "Nori Tip: Use the handle-large-tasks skill to split complex work for better context management"
    "Nori Tip: Control automatic updates with /nori-toggle-autoupdate"
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
    # No install issues - show rotating tip
    DAY_OF_YEAR=$(date +%j)
    HOUR=$(date +%H)
    TIP_SEED=$((DAY_OF_YEAR * 24 + HOUR))
    TIP_INDEX=$((TIP_SEED % ${#TIPS[@]}))
    SELECTED_TIP="${TIPS[$TIP_INDEX]}"
    STATUS_TIP="${DIM_WHITE}${SELECTED_TIP}${NC}"
fi

# Build status line with colors - split into three lines
# Line 1: Main metrics (git, [profile if set], cost, tokens, context, lines)
if [ -n "$PROFILE_NAME" ]; then
    echo -e "${MAGENTA}⎇ ${BRANCH}${NC} | ${YELLOW}Profile: ${PROFILE_NAME}${NC} | ${GREEN}Cost: \$${COST_FORMATTED}${NC} | ${CYAN}Tokens: ${TOKENS_FORMATTED}${NC} | Context: ${CONTEXT_FORMATTED} | Lines: ${LINES_FORMATTED}"
else
    echo -e "${MAGENTA}⎇ ${BRANCH}${NC} | ${GREEN}Cost: \$${COST_FORMATTED}${NC} | ${CYAN}Tokens: ${TOKENS_FORMATTED}${NC} | Context: ${CONTEXT_FORMATTED} | Lines: ${LINES_FORMATTED}"
fi
# Line 2: Branding
echo -e "${BRANDING}"
# Line 3: Status message (rotating tip or install error)
echo -e "${STATUS_TIP}"
