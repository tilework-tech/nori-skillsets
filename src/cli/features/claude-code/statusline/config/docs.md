# Noridoc: config

Path: @/src/cli/features/claude-code/statusline/config

### Overview

Shell script configuration for Claude Code status line integration, displaying git branch, active Nori profile, token usage, cost information, and rotating tips.

### How it fits into the larger codebase

This folder contains the nori-statusline.sh source script with {{install_dir}} template placeholders. The loader at @/src/cli/features/claude-code/statusline/loader.ts reads this script, performs template substitution to replace {{install_dir}} with the absolute install directory path, and writes the result to ~/.claude/nori-statusline.sh. The script is executed by Claude Code to generate status line content displayed at the bottom of the interface. It reads Claude Code conversation data from stdin and enriches it with config tier and profile information from .nori-config.json before formatting it for display.

### Core Implementation

**Template Variables:** The source script contains INSTALL_DIR="{{install_dir}}" which is replaced during installation with the absolute path to the install root. This templated value is used to locate $INSTALL_DIR/.nori-config.json for reading configuration.

**Enrichment Phases:** The script performs two enrichment phases before displaying output: (1) Config tier enrichment - reads $INSTALL_DIR/.nori-config.json to determine if auth credentials exist (free vs paid tier), and (2) Profile enrichment - reads profile.baseProfile from $INSTALL_DIR/.nori-config.json (defaults to empty string if not set).

**Metrics and Display:** After enrichment, the script extracts git branch info from the conversation's cwd, parses the transcript file to calculate token usage (input tokens, cache creation tokens, cache read tokens, output tokens, and context length from the most recent main chain entry), and formats cost estimates. The script outputs three lines: Line 1 shows metrics (git branch, profile if set, cost, tokens, context, lines changed), Line 2 shows branding with an upgrade link for free tier users, and Line 3 shows a rotating tip selected deterministically based on day_of_year * 24 + hour.

**Build-time Substitution:** Version information is injected during build via perl substitution in @/package.json build script.

### Things to Know

**Template Substitution:** The {{install_dir}} placeholder in this source script gets replaced with the absolute install directory path during installation. This is the key fix for the subdirectory detection bug - the install directory is baked into the script at install time rather than being derived from CWD at runtime.

**Subdirectory Bug:** Before this fix, the script tried to derive INSTALL_DIR from CWD at runtime, which meant when Claude Code ran from a subdirectory (e.g., Nori installed in ~, running from ~/projects/foo), the script would look for .nori-config.json in ~/projects/foo instead of ~, causing incorrect tier detection (showing free tier branding even for paid accounts).

**Why Template Not Runtime:** Template substitution was chosen over runtime upward search (like the autoupdate hook) because it's simpler in bash. The install directory never changes after installation, so baking it in avoids complex directory traversal logic.

**Profile Display:** The profile name enrichment allows users to see which behavioral preset is active - this is conditionally displayed only when profile.baseProfile exists in $INSTALL_DIR/.nori-config.json (not ~/nori-config.json).

**Performance and Format:** The script must be executable and return formatted text quickly to avoid UI lag. Token usage is calculated by parsing the transcript file. The script uses OSC 8 hyperlink format for the "upgrade" link in free tier branding. Version string __VERSION__ is replaced during build with the actual package version from package.json.
