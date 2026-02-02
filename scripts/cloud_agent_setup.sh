#!/bin/bash

# Cloud Agent Setup Script
# ========================
# Sets up the nori-skillsets coding agent environment for cloud-hosted
# Claude Code environments (e.g., Claude Code web).
#
# This script:
#   1. Checks if running in a Claude web environment (exits early if not)
#   2. Checks if nori-skillsets is already available
#   3. Determines the best JS package manager (bun preferred, npm fallback)
#   4. Installs nori-skillsets globally, or falls back to npx/bunx if permissions fail
#   5. Runs nori-skillsets install <skillset> from the repo root
#
# Usage:
#   ./scripts/cloud_agent_setup.sh [skillset]
#
#   skillset: Optional. The skillset to install (default: senior-swe)
#
# Requirements:
#   - Must be run from within a git repository
#   - Either bun or npm must be available
#   - Must be running in a Claude web environment

# Debug logging setup
DEBUG_LOG_DIR="${HOME}/.nori/logs"
DEBUG_LOG_FILE="${DEBUG_LOG_DIR}/cloud_agent_setup_$(date +%Y%m%d_%H%M%S).log"

# Create log directory if it doesn't exist
mkdir -p "$DEBUG_LOG_DIR"

# Logging function that writes to both stdout and log file
debug_log() {
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$timestamp] $1" | tee -a "$DEBUG_LOG_FILE"
}

# Log environment details at start
debug_log "=== Cloud Agent Setup Script Started ==="
debug_log "Log file: $DEBUG_LOG_FILE"
debug_log "PWD: $(pwd)"
debug_log "HOME: $HOME"
debug_log "PATH: $PATH"
debug_log "NODE_VERSION: $(node --version 2>/dev/null || echo 'not found')"
debug_log "NPM_VERSION: $(npm --version 2>/dev/null || echo 'not found')"
debug_log "BUN_VERSION: $(bun --version 2>/dev/null || echo 'not found')"
debug_log "--- Claude Environment Variables ---"
debug_log "CLAUDE_CODE_REMOTE: ${CLAUDE_CODE_REMOTE:-unset}"
debug_log "CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE: ${CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE:-unset}"
debug_log "CLAUDE_CODE_ENTRYPOINT: ${CLAUDE_CODE_ENTRYPOINT:-unset}"
debug_log "--- Proxy Variables ---"
debug_log "HTTP_PROXY: ${HTTP_PROXY:-unset}"
debug_log "HTTPS_PROXY: ${HTTPS_PROXY:-unset}"
debug_log "http_proxy: ${http_proxy:-unset}"
debug_log "https_proxy: ${https_proxy:-unset}"
debug_log "NO_PROXY: ${NO_PROXY:-unset}"

# Exit early if not in Claude web environment
is_claude_web_env() {
    # Environment indicators (most reliable)
    [[ "$CLAUDE_CODE_REMOTE" == "true" ]] || return 1
    [[ "$CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE" == "cloud_default" ]] || return 1
    [[ "$CLAUDE_CODE_ENTRYPOINT" == "remote" ]] || return 1

    return 0
}

if ! is_claude_web_env; then
    debug_log "Not a Claude web environment, skipping cloud setup"
    echo "Not a Claude web environment, skipping cloud setup"
    exit 0
fi

debug_log "Claude web environment detected, proceeding with setup"

set -e
set -u
set -o pipefail

# Parse arguments
SKILLSET="${1:-senior-swe}"

debug_log "Skillset argument: $SKILLSET"

# Logging functions (no color - cloud environments may not support ANSI escape codes)
log_info() {
    debug_log "[INFO] $1"
    echo "==> $1"
}

log_success() {
    debug_log "[SUCCESS] $1"
    echo "✓ $1"
}

log_error() {
    debug_log "[ERROR] $1"
    echo "✗ $1" >&2
}

# Detect repo root
log_info "Detecting repository root..."
if ! REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null); then
    log_error "Not inside a git repository"
    exit 1
fi
log_success "Repository root: $REPO_ROOT"

# Check connectivity to noriskillsets.dev registry
log_info "Checking connectivity to noriskillsets.dev..."
debug_log "Testing registry health endpoint..."
if ! curl -sf --connect-timeout 5 https://noriskillsets.dev/health > /dev/null 2>&1; then
    debug_log "FATAL: Registry health check failed"
    debug_log "curl exit code: $?"
    debug_log "Attempting verbose curl for debugging..."
    curl -v --connect-timeout 5 https://noriskillsets.dev/health 2>&1 | tee -a "$DEBUG_LOG_FILE" || true
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                                                                              ║"
    echo "║   ERROR: Cannot connect to noriskillsets.dev                                 ║"
    echo "║                                                                              ║"
    echo "║   This is required to download skillsets from the Nori registry.             ║"
    echo "║                                                                              ║"
    echo "║   If you're using Claude Code on the web, add these domains to your          ║"
    echo "║   organization's custom allowed domains list:                                ║"
    echo "║                                                                              ║"
    echo "║       noriskillsets.dev                                                      ║"
    echo "║       *.noriskillsets.dev                                                    ║"
    echo "║                                                                              ║"
    echo "║   Then RESTART this session for the changes to take effect.                  ║"
    echo "║                                                                              ║"
    echo "║   To configure allowed domains:                                              ║"
    echo "║   1. Go to your Claude organization settings                                 ║"
    echo "║   2. Navigate to 'Claude Code' or 'Network Access' settings                  ║"
    echo "║   3. Add the domains above to the custom allowed domains list                ║"
    echo "║   4. Start a new Claude Code session                                         ║"
    echo "║                                                                              ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo ""
    exit 1
fi
log_success "Registry is reachable"

# Check if nori-skillsets is already available
log_info "Checking if nori-skillsets is available..."
debug_log "Checking PATH for nori-skillsets..."
if command -v nori-skillsets &> /dev/null; then
    log_success "nori-skillsets is already installed"
    NORI_CMD="nori-skillsets"
    debug_log "nori-skillsets location: $(which nori-skillsets)"
    debug_log "nori-skillsets version: $(nori-skillsets --version 2>/dev/null || echo 'version check failed')"
else
    log_info "nori-skillsets not found, will install nori-skillsets package"
    debug_log "nori-skillsets not in PATH"

    # Determine the best JS package manager
    log_info "Detecting JavaScript package manager..."
    PKG_MANAGER=""
    RUNNER=""

    if command -v bun &> /dev/null; then
        PKG_MANAGER="bun"
        RUNNER="bunx"
        log_success "Found bun"
        debug_log "bun location: $(which bun)"
    elif command -v npm &> /dev/null; then
        PKG_MANAGER="npm"
        RUNNER="npx --yes"
        log_success "Found npm"
        debug_log "npm location: $(which npm)"
        debug_log "npm config get prefix: $(npm config get prefix 2>/dev/null || echo 'failed')"
    else
        log_error "Neither bun nor npm is available"
        log_error "Please install Node.js (npm) or bun first"
        debug_log "FATAL: No package manager found"
        exit 1
    fi

    # Attempt global install
    log_info "Attempting global install of nori-skillsets using $PKG_MANAGER..."
    debug_log "Attempting global install with $PKG_MANAGER..."
    INSTALL_SUCCESS=false

    if [ "$PKG_MANAGER" = "bun" ]; then
        debug_log "Running: bun install -g nori-skillsets"
        if bun install -g nori-skillsets 2>&1 | tee -a "$DEBUG_LOG_FILE"; then
            INSTALL_SUCCESS=true
            debug_log "bun global install succeeded"
        else
            debug_log "bun global install failed"
        fi
    else
        debug_log "Running: npm install -g nori-skillsets"
        if npm install -g nori-skillsets 2>&1 | tee -a "$DEBUG_LOG_FILE"; then
            INSTALL_SUCCESS=true
            debug_log "npm global install succeeded"
        else
            debug_log "npm global install failed"
        fi
    fi

    if [ "$INSTALL_SUCCESS" = true ]; then
        log_success "nori-skillsets installed globally"
        NORI_CMD="nori-skillsets"
        debug_log "nori-skillsets location after install: $(which nori-skillsets 2>/dev/null || echo 'not found')"
    else
        log_info "Global install failed (likely permissions), will use $RUNNER instead"
        NORI_CMD="$RUNNER nori-skillsets"
        debug_log "Will use runner: $NORI_CMD"
    fi
fi

# Change to repo root
log_info "Changing to repository root..."
cd "$REPO_ROOT"
log_success "Working directory: $(pwd)"

# Run nori-skillsets install <skillset>
log_info "Running: $NORI_CMD install $SKILLSET"
debug_log "--- Pre-install diagnostics ---"
debug_log "Current directory: $(pwd)"
debug_log "NORI_CMD resolved to: $NORI_CMD"
debug_log "Which nori-skillsets: $(which nori-skillsets 2>/dev/null || echo 'not in PATH')"

# Test connectivity to registry before install
debug_log "Testing registry connectivity before install..."
if curl -sf --connect-timeout 5 https://noriskillsets.dev/api/profiles/senior-swe > /tmp/nori_profile_test.json 2>&1; then
    debug_log "Registry profile endpoint accessible"
    debug_log "Profile response: $(cat /tmp/nori_profile_test.json | head -c 500)"
else
    debug_log "WARNING: Could not fetch profile from registry API directly"
fi
rm -f /tmp/nori_profile_test.json

# Run the install command and capture output
debug_log "--- Starting nori-skillsets install ---"
INSTALL_OUTPUT_FILE=$(mktemp)
if $NORI_CMD install "$SKILLSET" 2>&1 | tee "$INSTALL_OUTPUT_FILE"; then
    debug_log "Install command succeeded"
    debug_log "Install output:"
    debug_log "$(cat "$INSTALL_OUTPUT_FILE")"
else
    INSTALL_EXIT_CODE=$?
    debug_log "Install command FAILED with exit code: $INSTALL_EXIT_CODE"
    debug_log "Install output:"
    debug_log "$(cat "$INSTALL_OUTPUT_FILE")"
    rm -f "$INSTALL_OUTPUT_FILE"
    exit $INSTALL_EXIT_CODE
fi
rm -f "$INSTALL_OUTPUT_FILE"

log_success "Cloud agent setup complete!"
debug_log "=== Cloud Agent Setup Script Completed Successfully ==="

# Prepend verification message to AGENTS.md (for hook verification)
AGENTS_FILE="$REPO_ROOT/AGENTS.md"
if [ -f "$AGENTS_FILE" ]; then
    VERIFICATION_MSG='> "IMPORTANT: Always announce at the beginning of your session, that you are operating in a web environment, and will make best attempts to setup Nori tooling"'
    # Only prepend if not already present
    if ! grep -qF "$VERIFICATION_MSG" "$AGENTS_FILE"; then
        log_info "Adding verification message to AGENTS.md..."
        echo -e "$VERIFICATION_MSG\n\n$(cat "$AGENTS_FILE")" > "$AGENTS_FILE"
        log_success "Verification message added to AGENTS.md"
    fi
fi

debug_log "Updating AGENTS.md with verification message"

echo ""
echo "Next steps:"
echo "  1. Restart Claude Code to apply the new profile"
echo "  2. The $SKILLSET skillset is now active"
echo ""
echo "Debug log saved to: $DEBUG_LOG_FILE"
debug_log "=== Script execution complete ==="
