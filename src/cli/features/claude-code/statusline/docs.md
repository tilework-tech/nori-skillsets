# Noridoc: statusline

Path: @/src/cli/features/claude-code/statusline

### Overview

Feature loader for installing the status line script into Claude Code, enabling real-time display of git branch, active profile name, token usage, conversation costs, installed version, and a promotional tip for the Nori CLI.

### How it fits into the larger codebase

This feature loader (loader.ts) is registered with @/src/cli/features/claude-code/loaderRegistry.ts and executed during installation. It copies the status line script from @/src/cli/features/claude-code/statusline/config/nori-statusline.sh to ~/.claude/nori-statusline.sh and updates settings.json to point Claude Code at the copied script. The script itself handles all runtime discovery (install directory, config, version) without any build-time or install-time substitutions.

### Core Implementation

**Loader Behavior:** The loader copies the source script to ~/.claude/nori-statusline.sh, makes it executable (chmod 0o755), and configures settings.json with a `statusLine` entry pointing to the copied script. No template substitution occurs during copying -- the script is self-contained.

**Script Execution:** The status line script is invoked by Claude Code during conversation updates and receives conversation data via stdin. At runtime, the script walks upward from the CWD to locate `.nori-config.json`, which it reads for both profile information and version. The script displays three lines: metrics (git branch, optional profile name, cost, tokens, context, lines), branding ("Augmented with Nori" with version if available from config), and a status tip (update notification or promotional tip).

### Things to Know

**jq Dependency:** The script requires jq for JSON parsing. If jq is not installed, it displays a warning with installation instructions for macOS (`brew install jq`) and Linux (`apt install jq`), shows plain branding without version, and exits with code 0 to avoid Claude Code errors.

**Runtime Version Display:** Version is read at runtime from `.nori-config.json` (`.version` field) rather than injected at build time. The branding line shows "Augmented with Nori v{version}" when version is present, or just "Augmented with Nori" when it is not. This means the displayed version always reflects the installed version, not the built version.

**Subdirectory Detection:** The script uses a `find_install_dir()` function that searches upward from the CWD to locate `.nori-config.json`. This handles the case where Claude Code runs from a subdirectory (e.g., Nori installed in ~, running from ~/projects/foo).

**Profile Display:** Profile name is conditionally displayed only when .nori-config.json contains a `profile.baseProfile` value (checking `agents.claude-code.profile.baseProfile` first, then legacy path). When not set, the profile section is omitted from the metrics line.

**Tip Line / Update Notification:** The third line conditionally displays either an update notification or a static promotional tip. The script reads the version cache at `~/.nori/profiles/nori-skillsets-version.json` (populated by the CLI auto-update system at @/src/cli/updates/). If a newer version is available (not dismissed, passes a node-based semver comparison against `NORI_VERSION` from config), it shows an update message. Otherwise it falls back to the static promotional tip.

Created and maintained by Nori.
