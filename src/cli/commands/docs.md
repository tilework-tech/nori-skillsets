# Noridoc: commands

Path: @/src/cli/commands

### Overview

Contains all CLI command implementations for both the nori-ai and nori-skillsets CLIs. Each command lives in its own subdirectory with its implementation, tests, and any command-specific utilities co-located together.

### How it fits into the larger codebase

The CLI entry points (@/src/cli/nori-ai.ts and @/src/cli/nori-skillsets.ts) import `registerXCommand` functions from each command subdirectory and call them to register commands with the Commander.js program. Each command module exports a register function that accepts `{ program: Command }` and adds its command definition. Commands access global options (`--install-dir`, `--non-interactive`, `--agent`) via `program.opts()`. Business logic is encapsulated within each command directory - the entry points only handle routing.

Commands that interact with agent-specific features (install, uninstall, check, switch-profile) use the AgentRegistry (@/src/cli/features/agentRegistry.ts) to look up the agent implementation by name. The agent provides access to its LoaderRegistry, environment paths, and global feature declarations. Commands pass the `--agent` option through their call chain to ensure consistent agent context.

**Installation Flow Architecture:** The installation process is split into three commands that can be called independently or orchestrated together:

```
nori-ai install (orchestrator)
    |
    +-- init        (Step 1: Set up directories and config, capture existing config)
    |
    +-- onboard     (Step 2: Select profile and configure auth)
    |
    +-- loaders     (Step 3: Run feature loaders to install components)
```

- `init` - Creates `.nori-config.json`, `~/.nori/profiles/` directory, and optionally captures existing Claude Code configuration as a profile
- `onboard` - Prompts for Nori Web authentication and profile selection, updates config
- `install` - Orchestrates init → onboard → feature loaders, handles upgrade cleanup

**Init Command:** The init command (@/src/cli/commands/init/init.ts) handles first-time setup:
- **Skillset Persistence Warning Gate (interactive mode only):** Before any other operations, displays a prominent warning that changes to `~/.claude/skills/`, `~/.claude/CLAUDE.md`, and other configuration files will be overwritten by `switch-skillset`. Users must type the full word "yes" (case-insensitive, whitespace-trimmed) to proceed; any other input cancels initialization. This warning is skipped in non-interactive mode (`--non-interactive`) or when `skipWarning: true` is passed (used by `registry-download` auto-init to avoid confusing users who are just trying to download a profile).
- Creates `~/.nori/profiles/` directory for user-installed profiles
- Creates or updates `.nori-config.json` with version tracking
- Warns about ancestor installations that might cause CLAUDE.md conflicts
- Detects existing Claude Code configuration (`~/.claude/` CLAUDE.md, skills, agents, commands) and captures it as a profile:
  - Interactive mode: requires user to provide a profile name via `existingConfigCapture.ts` (user can abort with Ctrl+C)
  - Non-interactive mode: auto-captures as "my-profile"
- When a profile is captured, init performs three additional steps:
  - Deletes the original `~/.claude/CLAUDE.md` to prevent content duplication (the content was already captured to the profile with managed block markers)
  - Sets the captured profile as active by writing `agents.claude-code.profile.baseProfile` to config
  - Applies the managed block to `~/.claude/CLAUDE.md` by calling `claudeMdLoader.install()`
- Idempotent: preserves existing config fields (auth, agents, registryAuths) while updating version

**Onboard Command:** The onboard command (@/src/cli/commands/onboard/onboard.ts) handles profile and auth selection:
- Requires init to have been run first (config must exist)
- Prompts for Nori Web authentication (email, password, organization ID) or allows skipping
- For first-time installs: offers choice between pre-built profile or onboarding wizard
- Displays available profiles from both source (@/src/cli/features/claude-code/profiles/config/) and user-installed (`~/.nori/profiles/`)
- Non-interactive mode requires `--profile` flag if no existing profile is set
- Updates config with selected profile in `agents[agentName].profile` format

**switch-profile Agent Resolution:** The switch-profile command (@/src/cli/commands/switch-profile/profiles.ts) defines `--agent` as both a global option AND a local subcommand option, allowing `nori-ai switch-profile senior-swe --agent cursor-agent` syntax (local option takes precedence). The `resolveAgent()` function determines which agent to use:
- If `--agent` is explicitly provided: use that agent
- If no agents installed: default to `claude-code`
- If exactly one agent installed: auto-select it
- If multiple agents installed (interactive mode): prompt user to select from numbered list
- If multiple agents installed (non-interactive mode): throw error with helpful message listing installed agents

**switch-profile Installation Directory Resolution:** The switch-profile command uses `getInstallDirs()` for auto-detection when no explicit `--install-dir` is provided, allowing users to run `nori-ai switch-profile <profile>` from any subdirectory of a Nori installation. If an explicit `--install-dir` is provided, it uses `normalizeInstallDir()` to process that path. If no installation is found in the current directory or any ancestor directories, the command throws an error with a helpful message suggesting `nori-ai install` or the `--install-dir` flag. This aligns switch-profile with the check command's behavior.

**switch-profile Confirmation:** After agent resolution, the switch-profile command prompts the user to confirm before proceeding. The `confirmSwitchProfile()` function displays:
- Install directory being operated on
- Agent display name and ID (e.g., "Claude Code (claude-code)")
- Current profile (read from agent-specific config or legacy format, or "(none)" if not set)
- New profile being switched to

The user must enter "y" or "Y" to proceed; any other input cancels the operation. In non-interactive mode (`--non-interactive`), confirmation is skipped to allow automated/scripted usage.


**switch-profile Built-in Profile Handling:** The switch-profile command passes `skipBuiltinProfiles: true` to the install process. This prevents the profiles loader from copying all built-in profiles (amol, senior-swe, documenter, etc.) during profile switching. This is important for the `nori-skillsets download && nori-skillsets switch-skillset` workflow where users download a specific profile from the registry and only want that profile to be active, not all built-in profiles installed. The `skipBuiltinProfiles` flag is a runtime-only Config field (not persisted to disk) that the profiles loaders check before installing built-in profiles.
The uninstall command uses two agent methods for global features:
- `agent.getGlobalFeatureNames()`: Human-readable names for displaying in prompts (e.g., "hooks, statusline, and global slash commands")
- `agent.getGlobalLoaderNames()`: Loader names for determining which loaders to skip when preserving global settings (e.g., `["hooks", "statusline", "slashcommands"]`)

Each agent declares its own global features (e.g., claude-code has hooks, statusline, and global slash commands; cursor-agent has hooks and slash commands). If an agent has no global features, the global settings prompt is skipped entirely.

The install command sets `agents: { [agentName]: { profile } }` in the config, where the keys of the `agents` object indicate which agents are installed. The config loader merges `agents` objects with any existing config. The uninstall command prompts the user to select which agent to uninstall when multiple agents are installed at a location (in interactive mode).

**Install Non-Interactive Profile Requirement:** Non-interactive installs require either an existing configuration with a profile OR the `--profile` flag. This requirement is enforced by the onboard command. When no existing config is found, the onboard command errors with a helpful message listing available profiles and example usage. Example: `nori-ai install --non-interactive --profile senior-swe`.

**Install Agent-Specific Uninstall Logic:** The install command only runs uninstall cleanup when reinstalling the SAME agent (upgrade scenario). When installing a different agent (e.g., cursor-agent when claude-code is already installed), it skips uninstall to preserve the existing agent's installation. The logic:
1. Reads config at start to get installed agents via `getInstalledAgents({ config })` (keys of `agents` object)
2. For backwards compatibility: if no agents are installed but an installation exists (detected via hasExistingInstallation), assumes `["claude-code"]` (old installs didn't track agents)
3. Only runs uninstall if the agent being installed is already installed
4. Logs "Adding new agent (preserving existing X installation)..." when installing a different agent alongside existing ones
5. The `getInstalledVersion()` call is made ONLY inside the `if (!skipUninstall && agentAlreadyInstalled)` block - this ensures the function is only called when an installation is known to exist, since `getInstalledVersion()` throws an error if no version can be determined (checks config `version` field first, then falls back to deprecated `.nori-installed-version` file)

**Uninstall Agent Detection:** In non-interactive mode (used during upgrades), the uninstall command auto-detects the agent from config when `--agent` is not explicitly provided. It uses `getInstalledAgents({ config })` to determine installed agents from the `agents` object keys. If exactly one agent is installed, it uses that agent; otherwise it defaults to `claude-code`. This ensures the correct agent is uninstalled during autoupdate scenarios without requiring explicit `--agent` flags in older installed versions.

**Check Agent Detection:** The check command auto-detects the agent from config when `--agent` is not explicitly provided. Agent resolution occurs AFTER config loading (since the config is needed for detection). Logic:
- If `--agent` explicitly provided: use that agent
- If exactly one agent installed: auto-select it
- If multiple agents installed: error with "Multiple agents installed (X, Y). Please specify which agent to check with --agent <name>."
- If no agents in config (legacy fallback): default to `claude-code`

**Registry Commands Agent Validation:** Most registry and skill commands require Claude Code to be installed because profiles are stored at `~/.claude/profiles/` and skills at `~/.claude/skills/`. The shared `registryAgentCheck.ts` module provides validation:
- `checkRegistryAgentSupport({ installDir })` - Returns `{ supported: boolean, config: Config | null }`. Rejects if config has cursor-agent but NOT claude-code; allows all other cases (backwards compatible with older installs that have no agents field)
- `showCursorAgentNotSupportedError()` - Displays error message explaining registry requires Claude Code and how to install it

Registry commands (registry-search, registry-download, registry-update, registry-upload) and `skill-upload` call this validation early in their main function. **Exception:** `skill-download` does not use this validation - it allows downloading skills without any prior Nori installation.

**Skill Commands:** Two commands manage skills as first-class registry entities (mirroring the profile registry commands):
- `skill-download` - Download and install skills directly to `.claude/skills/{skill-name}/` in the target directory. Searches public registry first, then private registries. Creates `.nori-version` file for version tracking. Supports `--list-versions`, `--registry`, and `--skillset` options.
- `skill-upload` - Upload skills from `~/.claude/skills/` to a registry. Auto-bumps patch version when no version specified. Extracts description from SKILL.md frontmatter.

Skills follow the same tarball-based upload/download pattern as profiles. Downloaded skills go directly to `.claude/skills/`, making them immediately available in the Claude Code profile. Skills require a SKILL.md file (with optional YAML frontmatter containing name and description).

**skill-download No Installation Required:** Unlike other registry commands, `skill-download` does not require a prior Nori installation. The installation directory resolution:
1. If `--install-dir` is provided: uses that directory as the target
2. If existing Nori installation found via `getInstallDirs()`: uses that installation's directory
3. If no installation found: uses the current working directory (cwd) as the target

The command creates `.claude/skills/` directory if it doesn't exist. This allows users to simply drop skills into any directory without running `nori-ai init` or `nori-ai install` first. Config is loaded only for private registry authentication (if it exists).

**skill-download Manifest Update:** When a skill is downloaded, the command automatically adds it to a profile's `skills.json` manifest for dependency tracking. The target profile is determined by:
1. `--skillset <name>` option - explicitly specifies which profile to update
2. Active profile from config - if no `--skillset` is provided, uses the currently active profile
3. No manifest update - if neither is available, the skill downloads but no manifest is updated

The skill is added with version `"*"` (always latest). If the skill already exists in `skills.json`, its version is updated. The manifest update uses `addSkillDependency()` from @/src/cli/features/claude-code/profiles/skills/resolver.ts. Manifest update failures are non-blocking - the skill download succeeds even if the manifest cannot be written.

**Upload Commands Registry Resolution:** Both `registry-upload` (for profiles) and `skill-upload` (for skills) use the same registry resolution logic:
1. **Public registry (default):** When the user has unified auth (`config.auth`) with a `refreshToken`, the public registry (`https://noriskillsets.dev`) is automatically included as an available upload target. This is the default when no `--registry` flag is provided.
2. **Private registries:** Additional registries can be added via `registryAuths` in `.nori-config.json`. These are included alongside the public registry.
3. **Explicit registry:** Users can specify `--registry <url>` to target a specific registry. The command checks `availableRegistries` first (which includes the public registry for authenticated users), then falls back to `getRegistryAuth()` for legacy `registryAuths` lookups.
4. **Multiple registries:** If multiple registries are configured and no `--registry` is specified, the command prompts the user to select one (or errors in non-interactive mode).

**registry-download Auto-Init:** The `registry-download` command (and `nori-skillsets download`) automatically initializes Nori configuration when no installation exists, allowing users to download profiles without first running `nori-ai init` or `nori-ai install`. The installation directory resolution logic:
1. If `--install-dir` is provided but no installation exists there: calls `initMain({ installDir, nonInteractive: false })` to set up at that location
2. If no `--install-dir` and no existing installations found via `getInstallDirs()`: calls `initMain({ installDir: cwd, nonInteractive: false })` to set up at current directory
3. If multiple installations found: errors with a list of installations and prompts user to specify with `--install-dir`

By using `nonInteractive: false`, the auto-init triggers the interactive existing config capture flow - users with an existing `~/.claude/` configuration (CLAUDE.md, skills, agents, commands) must provide a profile name to save it before proceeding (or abort with Ctrl+C).

This differs from `registry-install`, which calls the full `installMain()` (orchestrating init, onboard, and loaders). The `registry-download` command only calls `initMain()` because download just places profile files without activating them - the user still needs to run `switch-profile` to activate the downloaded profile.

**registry-download Skill Dependencies:** The `registry-download` command automatically installs skill dependencies declared in a profile's `nori.json` manifest. After extracting a profile tarball, the command checks for a `nori.json` file with a `dependencies.skills` field (mapping skill names to version strings). For each declared skill:
1. Fetches the skill packument via `registrarApi.getSkillPackument()` to get the latest version
2. Checks if the already-installed version equals the latest version (skips download if so)
3. Downloads and extracts the skill tarball to the profile's own skills directory (`~/.nori/profiles/{profile-name}/skills/{skill-name}/`)
4. Writes a `.nori-version` file for version tracking

Skills always download the latest version - version ranges in `nori.json` are currently ignored but reserved for future use. Skills are downloaded from the same registry (with same auth token) as the profile being installed. Skill download failures are non-blocking - the command warns but continues with profile installation. Skills are stored in the profile's directory to keep profiles self-contained. The `nori.json` format supports externalized skills:
```json
{ "name": "profile-name", "version": "1.0.0", "dependencies": { "skills": { "skill-name": "*" } } }
```

```
nori-ai.ts (full CLI)
  |
  +-- registerInstallCommand({ program })      --> commands/install/install.ts
  +-- registerInitCommand({ program })         --> commands/init/init.ts
  +-- registerOnboardCommand({ program })      --> commands/onboard/onboard.ts
  +-- registerUninstallCommand({ program })    --> commands/uninstall/uninstall.ts
  +-- registerCheckCommand({ program })        --> commands/check/check.ts
  +-- registerSwitchProfileCommand({ program })--> commands/switch-profile/profiles.ts
  +-- registerInstallLocationCommand({ program })--> commands/install-location/installLocation.ts
  +-- registerRegistrySearchCommand({ program })--> commands/registry-search/registrySearch.ts
  +-- registerRegistryDownloadCommand({ program })--> commands/registry-download/registryDownload.ts
  +-- registerRegistryInstallCommand({ program })--> commands/registry-install/registryInstall.ts
  +-- registerRegistryUpdateCommand({ program })--> commands/registry-update/registryUpdate.ts
  +-- registerRegistryUploadCommand({ program })--> commands/registry-upload/registryUpload.ts
  +-- registerSkillDownloadCommand({ program })--> commands/skill-download/skillDownload.ts
  +-- registerSkillUploadCommand({ program })  --> commands/skill-upload/skillUpload.ts

nori-skillsets.ts (simplified CLI for registry read operations, skill downloads, profile switching, and initialization)
  |
  +-- registerNoriSkillsetsInitCommand({ program })          --> commands/noriSkillsetsCommands.ts --> initMain
  +-- registerNoriSkillsetsSearchCommand({ program })        --> commands/noriSkillsetsCommands.ts --> registrySearchMain
  +-- registerNoriSkillsetsDownloadCommand({ program })      --> commands/noriSkillsetsCommands.ts --> registryDownloadMain
  +-- registerNoriSkillsetsInstallCommand({ program })       --> commands/noriSkillsetsCommands.ts --> registryInstallMain
  +-- registerNoriSkillsetsSwitchSkillsetCommand({ program })--> commands/noriSkillsetsCommands.ts --> switchSkillsetAction
  +-- registerNoriSkillsetsDownloadSkillCommand({ program }) --> commands/noriSkillsetsCommands.ts --> skillDownloadMain
```

Commands use shared utilities from the parent @/src/cli/ directory:
- `config.ts` - Config type and persistence (with per-agent profile support)
- `logger.ts` - Unified logging via Winston. All console output uses these functions: `error()`, `success()`, `info()`, `warn()` for formatted messages; `newline()` for blank line spacing; `raw({ message })` for pre-formatted output (ASCII art, separators). Silent mode via `setSilentMode()`/`isSilentMode()` suppresses all console output while file logging to `/tmp/nori.log` continues. The `debug({ message })` function writes to file only (no console).
- `prompt.ts` - User input prompting
- `version.ts` - Version tracking for upgrades and CLI flag compatibility checking
- `installTracking.ts` - Install lifecycle and session tracking to Nori backend

Commands obtain feature loaders via the AgentRegistry (@/src/cli/features/agentRegistry.ts). The pattern is:
```typescript
// Parse --agent option and look up Agent object once at entry point
const agentImpl = AgentRegistry.getInstance().get({ name: agent ?? "claude-code" });

// Pass Agent object through call chain; access agentImpl.name when UID is needed
const registry = agentImpl.getLoaderRegistry();
const loaders = registry.getAll();
```

### Core Implementation

**Command Directory Pattern:** Each command directory contains:
- `{command}.ts` - Main implementation with `registerXCommand` export and business logic
- `{command}.test.ts` - Unit/integration tests
- Command-specific utilities (e.g., `install/asciiArt.ts`, `install/installState.ts`)

**Command Registration Pattern:** Each command exports a register function:
```typescript
export const registerXCommand = (args: { program: Command }): void => {
  const { program } = args;
  program
    .command("command-name")
    .description("...")
    .action(async () => {
      const globalOpts = program.opts();
      await main({ installDir: globalOpts.installDir || null });
    });
};
```

**Import Path Pattern:** Commands import from `@/cli/` for shared utilities and `@/cli/features/claude-code/` for loaders. Within the install command, relative imports are used for command-specific utilities (e.g., `./asciiArt.js`, `./installState.js`).

### Things to Know

The commands directory contains shared utilities at the top level:
- `registryAgentCheck.ts` - Shared validation for registry commands. Checks if the installation has only cursor-agent (no claude-code) and rejects with a helpful error message. Used by registry-search, registry-download, registry-update, registry-upload, and skill-upload commands. Note: `skill-download` does not use this validation.
- `cliCommandNames.ts` - CLI command name mapping for user-facing messages. Maps CLI names (`nori-ai`, `nori-skillsets`) to their respective command names (e.g., `registry-download` vs `download`, `switch-profile` vs `switch-skillset`). The `getCommandNames({ cliName })` function returns a `CommandNames` object with mappings for download, downloadSkill, search, update, upload, uploadSkill, and switchProfile. Defaults to nori-ai command names when `cliName` is null or undefined.

The `noriSkillsetsCommands.ts` file contains thin command wrappers for the nori-skillsets CLI - registration functions that provide simplified command names (`init`, `search`, `download`, `install`, `switch-skillset`, `download-skill`) by delegating to the underlying implementation functions (`*Main` functions from init, registry-*, and skill-* commands, `switchSkillsetAction` for switch-skillset). Upload, update, and onboard commands are only available via the nori-ai CLI. Each wrapper passes `cliName: "nori-skillsets"` to the `*Main` functions so user-facing messages display nori-skillsets command names (e.g., "run nori-skillsets switch-skillset" instead of "run nori-ai switch-profile"). This allows the nori-skillsets CLI to use cleaner command names while sharing all business logic with the nori-ai CLI.

The `install/` directory contains command-specific utilities:
- `asciiArt.ts` - ASCII banners displayed during installation. All display functions (displayNoriBanner, displayWelcomeBanner, displaySeaweedBed) check `isSilentMode()` and return early without output when silent mode is enabled.
- `installState.ts` - Helper to check for existing installations (wraps version.ts)
- `registryAuthPrompt.ts` - Prompts for private registry authentication during interactive install. Collects organization ID (or full URL for local dev), username, and password (hidden input). Organization IDs are converted to registry URLs using `buildRegistryUrl()` from @/src/utils/url.ts. Full URLs are accepted as a fallback for local development (e.g., `http://localhost:3000`). Supports preserving existing registryAuths from config and adding multiple registries. Uses `RegistryAuth` type from `@/cli/config.js`.
- `existingConfigCapture.ts` - Detects and captures existing Claude Code configurations as named profiles. The `detectExistingConfig()` function scans `~/.claude/` for CLAUDE.md, skills directory, agents directory, and commands directory. The `promptForExistingConfigCapture()` function displays what was found and requires the user to provide a valid profile name (lowercase alphanumeric with hyphens) - the user cannot decline and must either provide a name or abort with Ctrl+C. The `captureExistingConfigAsProfile()` function creates a profile directory at `~/.nori/profiles/<profileName>/` with: nori.json (unified manifest format with skill dependencies), CLAUDE.md (with managed block markers added if not present), and copies of skills/, agents/ (renamed to subagents/), and commands/ (renamed to slashcommands/).

**Install Command Silent Mode:** The `main()` function in install.ts accepts a `silent` parameter. When `silent: true`, the function calls `setSilentMode({ silent: true })` before execution and restores it to false in a `finally` block to prevent state leakage. Silent mode implies non-interactive mode. This is used by intercepted slash commands (e.g., `/nori-switch-profile` in both claude-code and cursor-agent) that call `installMain()` and need clean stdout to return JSON responses without corruption from installation messages like ASCII art banners.

The install command uses `agent.listSourceProfiles()` to get available profiles from the package source directory, combined with `agent.listProfiles({ installDir })` to include any user-installed profiles. This ensures each agent displays its own profiles (claude-code shows amol, senior-swe, etc.; cursor-agent shows its own profiles).

The `install-location/` command was extracted from inline definition in cli.ts to follow the same pattern as other commands.

Tests within each command directory use the same temp directory isolation pattern as other tests in the codebase, passing `installDir` explicitly to functions rather than mocking `process.env.HOME`.

Created and maintained by Nori.
