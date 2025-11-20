# Noridoc: statusline

Path: @/plugin/src/installer/features/statusline

### Overview

Feature loader for installing status line script into Claude Code, enabling real-time display of git branch, active profile name, token usage, conversation costs, and rotating tips about Nori features.

### How it fits into the larger codebase

This feature loader (loader.ts) is registered with @/plugin/src/installer/features/loaderRegistry.ts and executed during installation. It copies the status line script from @/plugin/src/installer/features/statusline/config to the Claude Code status line directory (~/.claude/status-line), enabling the status line display feature that shows conversation metrics and helpful tips at the bottom of the Claude Code interface.

### Core Implementation

The loader creates the status line directory if needed, copies nori-statusline.sh from the config subdirectory, and sets it as executable. The loader runs in both free and paid modes since status line doesn't require backend access. The status line script is invoked by Claude Code during conversation updates and receives conversation data via stdin. The script derives its install directory dynamically: it first tries to use the `cwd` field from the JSON input (which is where Claude Code is running), falling back to deriving the directory from its own script location if cwd is unavailable. This allows the script to find the correct `.nori-config.json` regardless of where Nori is installed. The script displays three lines: metrics (git branch, optional profile name, cost, tokens, context, lines), branding, and a rotating tip. Profile name is read from `.nori-config.json` (profile.baseProfile field) in the derived install directory and only displayed if set - when not set or config missing, the profile section is omitted entirely. Profile name appears in yellow between git branch and cost metrics to help users understand which behavioral preset (senior-swe, amol, product-manager) is currently active. Tips rotate deterministically every hour based on day_of_year \* 24 + hour, cycling through tips covering skills (brainstorming, prompt-analysis, webapp-testing, systematic-debugging, root-cause-tracing, receiving-code-review, recall, memorize), profile switching, noridocs features (clickable @/ references, /sync-noridocs command, nori-change-documenter subagent, documenter profile), git worktrees, PR workflows, Test Driven Development, and backend knowledge management.

### Things to Know

The status line provides real-time feedback to users about their conversation state including current git branch, optional active Nori profile, token usage, estimated costs, and helpful tips about available Nori features. The script derives its install directory from the `cwd` field in the JSON input from Claude Code, with a fallback to computing the directory from the script's own location (going up two directories from `.claude/status-line/`). This makes the script work correctly for both home directory installations and project-specific installations at custom paths. Profile name is conditionally displayed only when `.nori-config.json` exists in the install directory and contains a profile.baseProfile value - this helps users understand which behavioral preset (senior-swe, amol, product-manager) is currently active without cluttering the display when no profile is configured. The statusline script enriches the incoming conversation data by reading both config tier (free/paid) and profile name from `.nori-config.json` before rendering output. It requires no backend access so works in both free and paid modes. The script must be executable and fast to avoid UI lag. Changes to statusline script require restarting Claude Code to take effect. Cross-platform compatible (macOS and Linux).
