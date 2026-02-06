# Noridoc: config

Path: @/src/cli/features/claude-code/statusline/config

### Overview

Shell script configuration for Claude Code status line integration, displaying git branch, active Nori profile, token usage, cost information, and a promotional tip for the Nori CLI.

### How it fits into the larger codebase

This folder contains the nori-statusline.sh source script. The loader at @/src/cli/features/claude-code/statusline/loader.ts reads this script, performs template substitution, and writes the result to ~/.claude/nori-statusline.sh. The script is executed by Claude Code to generate status line content displayed at the bottom of the interface. It reads Claude Code conversation data from stdin and enriches it with profile information from .nori-config.json before formatting it for display.

### Core Implementation

**Install Directory Discovery:** The script searches upward from the CWD (extracted from JSON input) to find .nori-config.json, using a `find_install_dir()` function that walks parent directories. This replaces the previous template-based approach (`{{install_dir}}`), making the script portable across installations.

**Profile Enrichment:** The script reads profile.baseProfile from .nori-config.json (defaults to empty string if not set), checking the `agents.claude-code.profile.baseProfile` path first (new format) then falling back to the legacy `profile.baseProfile` path.

**Metrics and Display:** After enrichment, the script extracts git branch info from the conversation's cwd, parses the transcript file to calculate token usage (input tokens, cache creation tokens, cache read tokens, output tokens, and context length from the most recent main chain entry), and formats cost estimates. The script outputs three lines: Line 1 shows metrics (git branch, profile if set, cost, tokens, context, lines changed), Line 2 shows branding ("Augmented with Nori"), and Line 3 shows a promotional tip for the Nori CLI.

**Build-time Substitution:** Version information is injected during build via perl substitution in @/package.json build script.

### Things to Know

**Branding is always shown as "Augmented with Nori"** - there is no conditional branding based on authentication status.

**Profile Display:** The profile name is conditionally displayed only when profile.baseProfile exists in .nori-config.json (not ~/nori-config.json). Profile name appears in yellow between git branch and cost metrics.

**jq Dependency:** The script requires jq for JSON parsing. If jq is not installed, the script displays a warning message with installation instructions.

**Performance and Format:** The script must be executable and return formatted text quickly to avoid UI lag. Token usage is calculated by parsing the transcript file. Version string __VERSION__ is replaced during build with the actual package version from package.json.

**Promotional Tip:** The TIPS array contains a single promotional message encouraging users to install nori-ai-cli via npm.

Created and maintained by Nori.
