# Noridoc: init

Path: @/src/cli/commands/init

### Overview

- Initializes Nori configuration directories (`~/.nori/profiles/`) and creates or updates `~/.nori-config.json`
- Detects and captures existing Claude Code configuration as a named profile before Nori overwrites it
- Warns about ancestor Nori managed installations that could cause conflicting CLAUDE.md configurations

### How it fits into the larger codebase

- Called as the first step of the installation flow by `noninteractive()` in @/src/cli/commands/install/install.ts
- The interactive path delegates entirely to `initFlow` in @/src/cli/prompts/flows/init.js, passing callbacks for ancestor checks, config detection, config capture, and initialization
- The non-interactive path runs inline within `initMain()` and uses `@clack/prompts` (`log`, `note`) for all output
- Config persistence uses `loadConfig()` / `saveConfig()` from @/src/cli/config.js, always scoped to the home directory via `getHomeDir()`
- Existing config capture delegates to `detectExistingConfig()` and `captureExistingConfigAsProfile()` from @/src/cli/commands/install/existingConfigCapture.js
- Ancestor installation detection uses `getInstallDirsWithTypes()` from @/src/utils/path.js
- After capturing a profile, installs the managed CLAUDE.md block via `claudeMdLoader.install()` from @/src/cli/features/claude-code/profiles/claudemd/loader.js
- After installation, calls `claudeCodeAgent.markInstall()` to write `.claude/.nori-managed` with the captured profile name, marking the directory as having the agent installed

### Core Implementation

- `initMain({ installDir, nonInteractive, skipWarning })` is the single entry point; routes to interactive (`initFlow`) or non-interactive (inline) path based on the `nonInteractive` flag
- **Existing installation skip**: Both the interactive and non-interactive paths use `claudeCodeAgent.isInstalledAtDir()` to skip existing-config detection when the agent is already installed at the target directory. This prevents re-capturing configuration on subsequent inits.
- **Non-interactive ancestor warning**: when managed installations exist in ancestor directories, constructs a multi-line warning using `yellow()` and `bold()` color helpers from @/src/cli/logger.js and renders it as a clack `note()` box with a `"Warning"` title
- **Non-interactive config capture**: when no existing Nori config is found but a Claude Code config exists, auto-captures it as a profile named `"my-profile"` and reports via `log.success()`
- After saving config, if a profile was captured, the original CLAUDE.md is deleted to prevent content duplication when the managed block is subsequently installed
- `registerInitCommand({ program })` registers the `init` command with Commander.js, passing through global `--install-dir` and `--non-interactive` options

### Things to Know

- The ancestor warning only fires for installations of type `"managed"` or `"both"` (not `"source"` only), which means the parent directory must contain a CLAUDE.md with Nori managed block markers
- Config loading always uses `getHomeDir()` as `startDir` (not the install directory) because init is a home-directory-scoped operation
- The `skipWarning` parameter exists for downstream callers (like download flows) that run init as a side-effect and do not want the profile persistence warning displayed in the interactive flow
- All CLI output in the non-interactive path uses `@clack/prompts` -- the only imports from `@/cli/logger.js` are the `bold` and `yellow` color helper functions

Created and maintained by Nori.
