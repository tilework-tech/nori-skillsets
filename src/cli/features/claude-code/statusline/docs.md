# Noridoc: statusline

Path: @/src/cli/features/claude-code/statusline

### Overview

Feature loader for installing status line script into Claude Code, enabling real-time display of git branch, active profile name, token usage, conversation costs, and a promotional tip for the Nori CLI.

### How it fits into the larger codebase

This feature loader (loader.ts) is registered with @/src/cli/features/claude-code/loaderRegistry.ts and executed during installation. It copies and templates the status line script from @/src/cli/features/claude-code/statusline/config/nori-statusline.sh to ~/.claude/nori-statusline.sh, substituting {{install_dir}} with the absolute install directory path. The loader updates settings.json to point Claude Code at the copied script, enabling the status line display feature that shows conversation metrics and a promotional tip at the bottom of the Claude Code interface.

### Core Implementation

**Template Substitution Approach:** The loader reads the source script from @/src/cli/features/claude-code/statusline/config/nori-statusline.sh, replaces {{install_dir}} placeholders with the absolute path to the install root (path.dirname(config.installDir)), and writes the substituted script to ~/.claude/nori-statusline.sh. This approach "bakes in" the install directory at installation time, eliminating the need for runtime directory traversal in bash. The loader makes the copied script executable (chmod 0o755) and updates settings.json to point to it.

**Script Execution:** The status line script is invoked by Claude Code during conversation updates and receives conversation data via stdin. The script locates .nori-config.json for reading profile information. The script displays three lines: metrics (git branch, optional profile name, cost, tokens, context, lines), branding (always "Augmented with Nori"), and a promotional tip for the Nori CLI. Profile name is read from .nori-config.json (profile.baseProfile field) and only displayed if set - when not set or config missing, the profile section is omitted entirely. Profile name appears in yellow between git branch and cost metrics to help users understand which behavioral preset (senior-swe, amol, product-manager) is currently active.

### Things to Know

**jq Dependency:** The script requires jq for JSON parsing (used extensively throughout). If jq is not installed, the script displays a warning message with installation instructions for both macOS (`brew install jq`) and Linux (`apt install jq`), shows Nori branding, and exits with code 0 to avoid Claude Code errors. Unlike notify-hook.sh which has fallback JSON parsers (python3, node, sed), statusline requires jq due to its extensive JSON manipulation throughout the script.

**Subdirectory Detection Fix:** The install directory is templated into the bash script at installation time ({{install_dir}} → absolute path), not derived at runtime. This solves the subdirectory detection bug where the script would fail to find config when Claude Code ran from a subdirectory (e.g., Nori installed in ~, running from ~/projects/foo).

**Template vs Runtime Search:** This fix uses template substitution (similar to skills installation), unlike the autoupdate hook which uses TypeScript utility functions for upward search. Template substitution is simpler for bash scripts since it eliminates runtime directory traversal complexity. The install directory is baked into the script when it's copied to ~/.claude/nori-statusline.sh during installation.

**Absolute Paths:** The script uses absolute paths (not tilde notation) since ~ doesn't expand in bash variable assignments. The loader derives installRoot as path.dirname(config.installDir) before substituting it into the script.

**Profile Display:** Profile name is conditionally displayed only when .nori-config.json exists in the install directory and contains a profile.baseProfile value. This helps users understand which behavioral preset is active without cluttering the display when no profile is configured.

**Performance:** The script must be executable and fast to avoid UI lag. Changes to the statusline script source require reinstalling the feature or manually updating the copied script at ~/.claude/nori-statusline.sh. Cross-platform compatible (macOS and Linux).

**Promotional Tip:** The third line displays a static promotional tip encouraging users to install the nori-ai-cli package via npm.

Created and maintained by Nori.
