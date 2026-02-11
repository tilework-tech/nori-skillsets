# Noridoc: config

Path: @/src/cli/features/claude-code/statusline/config

### Overview

Shell script configuration for Claude Code status line integration, displaying git branch, active Nori profile, token usage, cost information, installed version, and a promotional tip for the Nori CLI.

### How it fits into the larger codebase

This folder contains the nori-statusline.sh source script. The loader at @/src/cli/features/claude-code/statusline/loader.ts copies this script directly to ~/.claude/nori-statusline.sh (no template substitution). The script is executed by Claude Code to generate status line content displayed at the bottom of the interface. It reads Claude Code conversation data from stdin and enriches it with profile and version information from .nori-config.json before formatting it for display.

### Core Implementation

**Install Directory Discovery:** The script searches upward from the CWD (extracted from JSON input) to find .nori-config.json, using a `find_install_dir()` function that walks parent directories. This makes the script portable across installations without requiring any install-time path substitution.

**Config Reading:** Once `.nori-config.json` is located, the script reads two pieces of data from it: the profile name (`agents.claude-code.profile.baseProfile` with fallback to legacy `profile.baseProfile`) and the installed version (`.version` field). Both are used downstream -- profile for the metrics line, version for the branding line and update comparison.

**Metrics and Display:** The script extracts git branch info from the conversation's cwd, parses the transcript file to calculate token usage (input tokens, cache creation tokens, cache read tokens, output tokens, and context length from the most recent main chain entry), and formats cost estimates. The script outputs three lines: Line 1 shows metrics (git branch, profile if set, cost, tokens, context, lines changed), Line 2 shows branding with conditional version, and Line 3 shows a status tip.

### Things to Know

**Runtime Version (no build-time substitution):** Version is read at runtime from `.nori-config.json` using jq. The branding line shows "Augmented with Nori v{version}" when the `.version` field is present, or "Augmented with Nori" when it is absent. The build pipeline (@/scripts/build.sh) no longer performs any version substitution on this script.

**Profile Display:** The profile name is conditionally displayed only when profile.baseProfile exists in .nori-config.json. Profile name appears in yellow between git branch and cost metrics.

**jq Dependency:** The script requires jq for JSON parsing. If jq is not installed, it displays a warning message with installation instructions and shows plain branding without version.

**Promotional Tip:** The TIPS array contains a single promotional message encouraging users to install nori-ai-cli via npm.

Created and maintained by Nori.
