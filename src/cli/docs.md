# Noridoc: cli

Path: @/src/cli

### Overview

CLI for Nori Profiles that prompts for configuration, installs features into Claude Code, manages credentials, and tracks installation analytics via Google Analytics, supporting both free (local-only) and paid (backend-integrated) installation modes with directory-based profile system. The CLI uses Commander.js for command routing, argument parsing, and help generation.

### How it fits into the larger codebase

**CLI Architecture:** The package provides two CLI binaries (defined in @/package.json bin):

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `nori-ai` | @/src/cli/nori-ai.ts | Full CLI with all commands for Nori Profiles installation, management, and registry operations |
| `nori-skillsets` | @/src/cli/nori-skillsets.ts | Minimal CLI focused only on registry operations |

Both CLIs use Commander.js for command routing, argument parsing, validation, and help generation. Both define the same global options (`--install-dir`, `--non-interactive`, `--silent`, `--agent`) on the main program. Each command lives in its own subdirectory under @/src/cli/commands/ and exports a `registerXCommand({ program })` function that the entry points import and call. Commands access global options via `program.opts()`. Both CLIs provide automatic `--help`, `--version`, and unknown command detection. Running either binary with no arguments shows help. The CLI layer is responsible ONLY for parsing and routing - all business logic remains in the command modules. Both entry points configure analytics tracking by calling `setTileworkSource()` and `trackInstallLifecycle()` at startup before any commands are registered - `nori-ai` sets source to "nori-ai" and `nori-skillsets` sets source to "nori-skillsets" to distinguish usage in analytics data.

**Global Options:**

| Option | Description |
|--------|-------------|
| `-d, --install-dir <path>` | Custom installation directory (default: current working directory) |
| `-n, --non-interactive` | Run without interactive prompts |
| `-s, --silent` | Suppress all console output (implies `--non-interactive`) |
| `-a, --agent <name>` | AI agent to use (auto-detected from config, or defaults to claude-code) |

The `--silent` flag suppresses ALL console output including ASCII art banners, success/error messages, info logs, and all other output. This is more aggressive than `--non-interactive` which only skips interactive prompts. Silent mode is primarily used by hook scripts (e.g., `/nori-switch-profile`) that call `installMain()` and need clean stdout to return JSON responses without corruption from installation messages.

The `--agent` option enables support for multiple AI agents. Commands use the AgentRegistry (@/src/cli/features/agentRegistry.ts) to look up the agent implementation and obtain agent-specific loaders and environment paths. When `--agent` is not provided, commands may auto-detect the agent from the existing config's `agents` field (using `getInstalledAgents({ config })` helper).

**CLI Directory Structure:**

```
src/cli/
  nori-ai.ts             # Full CLI entry point with all commands
  nori-skillsets.ts      # Minimal CLI entry point for registry operations only
  config.ts              # Config type and persistence (supports per-agent profiles)
  logger.ts              # Console output formatting via Winston
  prompt.ts              # User input prompting
  version.ts             # Version tracking for upgrades + package root discovery
  installTracking.ts     # Install lifecycle and session tracking to Nori backend
  features/              # Multi-agent abstraction layer (see @/src/cli/features/docs.md)
    agentRegistry.ts     # AgentRegistry singleton + shared Loader/LoaderRegistry types
    config/              # Shared config loader (used by all agents)
    claude-code/         # Claude Code agent implementation (see @/src/cli/features/claude-code/docs.md)
    cursor-agent/        # Cursor agent implementation (see @/src/cli/features/cursor-agent/docs.md)
  commands/              # Command implementations
    install/             # Install command + asciiArt, installState utilities
    init/                # Initialize Nori configuration and directories
    onboard/             # Profile and auth selection
    uninstall/           # Uninstall command
    check/               # Check/validation command
    switch-profile/      # Profile switching command
    install-location/    # Display installation directories
    registry-search/     # Search for profiles and skills in registrar
    registry-download/   # Download from registrar
    registry-install/    # Download + install + activate from public registrar
    registry-update/     # Update installed registry profiles
    registry-upload/     # Upload to registrar
    skill-download/      # Download a skill from registrar
    skill-upload/        # Upload a skill to registrar
    watch/               # Monitor Claude Code sessions and save transcripts
```

**CLI Commands:**

| nori-ai Command | nori-skillsets Command | Module | Description |
|-----------------|-----------------|--------|-------------|
| `install` | | commands/install/install.ts | Install Nori Profiles with profile selection |
| `init` | `init` | commands/init/init.ts | Initialize Nori configuration and directories |
| `onboard` | | commands/onboard/onboard.ts | Select profile and configure authentication |
| `uninstall` | | commands/uninstall/uninstall.ts | Remove Nori installation |
| `check` | | commands/check/check.ts | Validate installation and configuration |
| `switch-profile`, `switch-skillset` | `switch-skillset` | commands/switch-profile/profiles.ts | Switch to a different profile/skillset |
| `install-location` | | commands/install-location/installLocation.ts | Display installation directories |
| `registry-search` | `search` | commands/registry-search/registrySearch.ts | Search for profiles and skills in the Nori registrar |
| `registry-download` | `download` | commands/registry-download/registryDownload.ts | Download and install a profile from the Nori registrar |
| `registry-install` | `install` | commands/registry-install/registryInstall.ts | Download, install, and activate a profile from the public registrar |
| `registry-update` | | commands/registry-update/registryUpdate.ts | Update an installed registry profile to the latest version |
| `registry-upload` | | commands/registry-upload/registryUpload.ts | Upload a profile package to the Nori registrar |
| `skill-search` | | commands/skill-search/skillSearch.ts | Search for skills in the Nori registrar |
| `skill-download` | `download-skill` | commands/skill-download/skillDownload.ts | Download a skill from the Nori registrar |
| `skill-upload` | | commands/skill-upload/skillUpload.ts | Upload a skill to the Nori registrar |
| | `watch`, `watch stop` | commands/watch/watch.ts | Monitor Claude Code sessions and save transcripts |
| | `login` | commands/login/login.ts | Authenticate with noriskillsets.dev |
| | `logout` | commands/logout/logout.ts | Clear stored authentication credentials |

The nori-skillsets CLI uses simplified command names (no `registry-` prefix for registry read operations, `download-skill` for skill downloads, `switch-skillset` for profile switching, `init` for initialization, and `watch` for session monitoring). Upload, update, and onboard operations are only available via the nori-ai CLI. Both CLIs share the same underlying implementation functions - the nori-skillsets commands are thin wrappers defined in @/src/cli/commands/noriSkillsetsCommands.ts that delegate to the existing implementations (`*Main` functions from registry-*, skill-*, watch, and init commands, plus `switchSkillsetAction` from profiles.ts).

Each command directory contains the command implementation, its tests, and any command-specific utilities (e.g., `install/` contains `asciiArt.ts` and `installState.ts`).

**Installation Flow:** The installer (install.ts) orchestrates the installation process. For first-time interactive installs (no existing Nori config), it first detects and offers to capture existing Claude Code configurations (CLAUDE.md, skills, agents, commands) as a named profile via existingConfigCapture.ts before proceeding with profile selection. It then prompts for credentials (prompt.ts), selecting a profile from available directories, prompting for private registry authentication (registryAuthPrompt.ts), loading/saving configuration (config.ts), and executing feature loaders from @/src/cli/features/claude-code/. It creates `<installDir>/.nori-config.json` containing auth credentials and selected profile name, and installs components into `<installDir>/.claude/`. By default, installDir is `process.cwd()`, so running `cd /project && npx nori-ai install` creates files in `/project/`. The profile selection determines which complete directory structure (CLAUDE.md, skills/, subagents/, slashcommands/) gets installed from the user's profiles directory at `<installDir>/.nori/profiles/{profileName}/`. Each profile is a self-contained directory with a CLAUDE.md file that defines the profile. Profiles are obtained from the registry or created by users; no built-in profiles are bundled with the package. The installer is also used by the uninstaller (uninstall.ts) which removes installed components. The installTracking.ts module tracks installation and session events to the Nori backend, providing visibility into installation patterns and user adoption. Profile switching is handled by profiles.ts (switchProfile, listProfiles) which preserves auth credentials while updating the selected profile.

**installDir Architecture:** The codebase follows a strict pattern where `installDir` is a required parameter for all internal functions. CLI entry points (install.ts:main, uninstall.ts:main, check.ts:checkMain, profiles.ts:switchProfile) are the ONLY places that accept optional installDir. These entry points either call normalizeInstallDir() from @/src/utils/path.ts or use getInstallDirs() to auto-detect installations. The `install-location`, `uninstall`, and `check` commands all use `getInstallDirs({ currentDir: process.cwd() })` to discover installations in the current directory or ancestor directories, using the closest installation found. The `installDir` is the BASE directory (e.g., `/home/user/project`), NOT the `.claude` directory. All files are stored relative to this base:
- `<installDir>/.nori-config.json` - config file with version tracking (via getConfigPath)
- `<installDir>/.claude/` - Claude Code configuration (via getClaudeDir)

This ensures that when running `cd /foo/bar && npx nori-ai install`, all files are created in `/foo/bar/` rather than the user's home directory. Note: The `.nori-installed-version` file has been deprecated - version is now stored in the `version` field of `.nori-config.json`.

The install.ts main function first normalizes installDir via `const normalizedInstallDir = normalizeInstallDir({ installDir })`, then checks for Nori installations in ancestor directories using findAncestorInstallations() from @/utils/path.ts. If any are found, it displays a warning explaining that Claude Code loads CLAUDE.md files from all parent directories, lists the ancestor installation paths, and provides uninstall commands. In interactive mode, it prompts for confirmation before proceeding; in non-interactive mode (e.g., autoupdate), it warns and continues.

**Config Migration During Install:** Both interactive and non-interactive modes use the `loadAndMigrateConfig({ installDir })` helper early in the flow. This helper:
1. Loads the existing config via `loadConfig()`
2. If no config exists (first-time install), returns null and skips migration
3. If config exists but has no `version` field, attempts fallback to deprecated `.nori-installed-version` file. If that file exists and contains valid semver, uses it as the version for migration. If no fallback is available, throws an error requiring manual `nori-ai uninstall` before reinstall
4. Calls `migrate()` from @/src/cli/features/migration.ts to apply any necessary migrations based on the config's version
5. Returns the migrated config for use in the installation flow

After migration, the install flow checks if an existing installation exists using hasExistingInstallation({ installDir: normalizedInstallDir }) from version.ts, which returns true if the version file (`<installDir>/.nori-installed-version`) exists OR if the config file (`<installDir>/.nori-config.json`) exists. The required installDir parameter ensures consistent checking - both the version check and config file check use the same directory context. If an installation exists, it runs uninstall for the previously installed version (tracked via version.ts) to ensure clean upgrades, UNLESS the optional skipUninstall parameter is true. The skipUninstall parameter is used during profile switching (see @/src/cli/cli.ts switch-profile command) to preserve custom user profiles that would otherwise be removed during uninstall. If no installation exists (first-time install), it skips the uninstall step and displays "First-time installation detected." This prevents confusing cleanup messages for first-time users. After the conditional uninstall, it displays the NORI ASCII art banner via asciiArt.ts in interactive mode. The promptForConfig function handles two flows: (1) interactive - prompts for credentials via promptForCredentials, then profile selection via promptForProfileSelection which dynamically discovers profiles by scanning for directories with CLAUDE.md, (2) non-interactive - uses existing config from disk or defaults to free mode with senior-swe profile. The config.ts module manages a unified Config type (auth credentials + profile.baseProfile + user preferences + installDir) that is used for both disk persistence and runtime. Paid vs free installation is determined by `isPaidInstall({ config })` which checks if `config.auth != null`. The LoaderRegistry from features/claude-code/loaderRegistry.ts executes all feature loaders sequentially, including the configLoader which serves as the single point of config persistence during installation. Key loaders: (1) profiles loader ensures `<installDir>/.nori/profiles/` exists and configures permissions, (2) claudemd loader reads the selected profile's CLAUDE.md, appends a dynamically-generated skills list by globbing for \*\*/SKILL.md files in the profile's skills/ directory, and embeds everything in a managed block, (3) skills/subagents/slashcommands loaders copy files from the profile's respective subdirectories to `<installDir>/.claude/`. The installer tracks plugin_install_started and plugin_install_completed events with install_type and non_interactive parameters, and saves the current version using saveInstalledVersion for future upgrade cleanup.

The uninstall.ts module removes Nori-installed components from the system. The main() entry point accepts an optional installDir that gets normalized by normalizeInstallDir() from @/utils/path.ts. In interactive mode, the generatePromptConfig() function first checks if the current installDir has a Nori installation using hasNoriInstallation() from @/utils/path.ts. If no local installation exists, it searches for ancestor installations using findAncestorInstallations(), which returns an array of ancestor directories ordered from closest to furthest. The UX handles three scenarios: (1) no installation found anywhere - displays "No Nori installation found in current or ancestor directories" and exits gracefully, (2) exactly one ancestor installation - displays "No Nori installation found in current directory" and "Found installation in ancestor directory: {path}", then prompts "Uninstall from this ancestor location? (y/n)" - if the user confirms, installDir is updated to the ancestor path and uninstall proceeds, (3) multiple ancestor installations - displays "No Nori installation found in current directory" and "Found installations in ancestor directories:" with numbered options (1, 2, 3...), then prompts "Select installation to uninstall (1-N), or 'n' to cancel" - the user can select a number or type 'n' to cancel; invalid selections display "Invalid selection. Uninstallation cancelled."

**Multi-Agent Uninstall:** After location selection, generatePromptConfig() checks if multiple agents are installed at the location (via `getInstalledAgents({ config })`). When multiple agents are installed and no `--agent` option was provided, it displays the installed agents and prompts the user to select which one to uninstall. The selected agent is returned in `PromptConfig.selectedAgent`. When only one agent is installed, it selects that agent automatically. The runUninstall() function sets `config.agents = { [agentName]: existingAgentConfig }` before calling the config loader's uninstall, so the loader knows which agent to remove from the agents object.

Non-interactive mode bypasses ancestor detection and multi-agent selection, operating strictly on the provided installDir and agent name to preserve autoupdate workflow expectations. The runUninstall() function executes loaders in reverse order using registry.getAllReversed() - this is critical because during install, profiles must run first to create profile directories that other loaders read from, but during uninstall, profiles must run last so slashcommands, subagents, and other loaders can still access profile directories to determine which files to remove. After all loaders complete their individual cleanup, uninstall.ts performs central cleanup: cleanupEmptyDirectories() removes ~/.claude/agents/ and ~/.claude/commands/ if they're empty (preserving user-created content), and cleanupNotificationsLog() removes the legacy `{installDir}/.nori-notifications.log` file for backward compatibility with older versions. Note: The current consolidated log file at `/tmp/nori.log` is NOT removed during uninstall since it's a shared system temp file. Config file handling depends on whether other agents remain installed - if no agents remain, the config file is deleted; if other agents remain, only the uninstalled agent is removed from the `agents` object (handled by config loader).

The check.ts module validates a Nori installation's configuration and feature installations. The checkMain() entry point auto-detects installations using `getInstallDirs({ currentDir: process.cwd() })` from @/utils/path.ts - the same discovery mechanism used by `install-location` and `uninstall`. If no `--install-dir` is explicitly provided, it uses the closest installation found (first element of the installations array). If no installation is found, it displays an error message suggesting to run `nori-ai install` or use `--install-dir`, and exits with code 1. The validation process checks: (1) configuration validity via validateConfig(), (2) server connectivity for paid installations via handshake(), (3) all feature loader validations via LoaderRegistry. Each check displays success (✓) or failure (✗) with detailed error messages.

The version.ts module manages version tracking for installation upgrades and CLI flag compatibility. Version is now stored as a `version` field in `.nori-config.json` rather than in a separate `.nori-installed-version` file. The `getInstalledVersion()` function is async and reads from the config file via `loadConfig()`. If the config has a `version` field, it returns that value. If the config exists but has no `version` field, the function falls back to reading from the deprecated `.nori-installed-version` file - if that file exists and contains valid semver, it returns that version. If neither source provides a version, the function throws an error with message "Installation out of date: no version field found in .nori-config.json file." - callers must handle this error or only call the function when an installation is known to exist. This fallback enables upgrades from old installations that have `.nori-config.json` without a `version` field. The `getCurrentPackageVersion()` function reads the version from the package.json by using `findPackageRoot()` to walk up from the current file's directory looking for a package.json with a valid Nori package name (`nori-ai` or `nori-skillsets`), enabling version display for both the full CLI and the standalone skillsets package. The function accepts an optional `startDir` parameter (defaults to `__dirname`) to control where the search begins, which is useful for testing.

**Version Compatibility Checking:** The version.ts module provides CLI flag compatibility checking via `supportsAgentFlag({ version })`. The `--agent` flag was introduced in version 19.0.0 with multi-agent support. When the install command needs to clean up a previous installation, it calls the *installed* `nori-ai` binary (not the new version being installed). If the installed version is older than 19.0.0, passing `--agent` causes an "unknown option" error. The install.ts module builds the uninstall command string inline, conditionally including `--agent` only when the installed version supports it (>= 19.0.0) via `supportsAgentFlag()`. For older versions, omitting the flag is safe because the uninstall defaults to claude-code anyway. This pattern can be extended for future CLI flag compatibility issues.

The logger.ts module provides console output formatting with ANSI color codes, powered by the Winston logging library. Standard logging functions (error, success, info, warn, debug) use colors.RED, colors.GREEN, colors.CYAN, colors.YELLOW respectively. Additional formatting helpers (brightCyan, boldWhite, gray) use formatColors for enhanced visual hierarchy in CLI output - these return strings with ANSI codes applied. The logger uses a custom ConsoleTransport for console output (using console.log/console.error for test spy compatibility) and Winston's File transport for persistent logging. All log output is appended to `/tmp/nori.log` for debugging. This consolidated log file replaces the previous split logging approach (which used `/tmp/nori-installer.log` for CLI and `{installDir}/.nori-notifications.log` for hooks).

**Silent Mode:** The logger module provides `setSilentMode({ silent: boolean })` and `isSilentMode()` functions for controlling console output globally. When silent mode is enabled via `consoleTransport.silent = true`, the custom ConsoleTransport skips all console output while Winston's File transport continues logging to `/tmp/nori.log`. The `newline()` and `raw()` functions also check the transport's silent property. Silent mode is set/restored in a `finally` block by the install command's `main()` function to prevent state leakage.

The promptForProfileSelection function in install.ts uses these formatters to display profile options with brightCyan numbers, boldWhite names, and gray indented descriptions, separated by blank lines for improved scannability. The promptForCredentials function displays a wrapped prompt asking users to enter credentials or skip for free tier.

The config.ts module provides a unified `Config` type for both disk persistence and runtime use. The `Config` type contains: auth credentials via `AuthCredentials` type (username, organizationUrl, refreshToken, password), agents (per-agent configuration - keys indicate installed agents, each with their own profile), user preferences (sendSessionTranscript, autoupdate), registry authentication (registryAuths array), and the required installDir field.

**AuthCredentials Type:** Supports both token-based and legacy password-based authentication:
- `username` and `organizationUrl` - required for all paid installs
- `refreshToken` - preferred, secure token-based auth (Firebase refresh token)
- `password` - legacy, deprecated (will be removed in future)
- `organizations` - array of organization IDs the user has access to (populated by login command from `/api/auth/check-access`)
- `isAdmin` - whether the user has admin privileges for their organization

The `isLegacyPasswordConfig({ config })` helper identifies configs that have password but no refreshToken (candidates for migration).

**Multi-Agent Config Structure:** The config supports per-agent profiles via the `agents` field, a `Record<string, AgentConfig>` where each agent has its own profile. The keys of the `agents` object serve as the source of truth for which agents are installed (replacing the former `installedAgents` array). Use `getInstalledAgents({ config })` helper to get the list of installed agents. For backwards compatibility during config loading:
- `loadConfig()` converts legacy `profile` field to `agents.claude-code.profile` if `agents` is not present
- The migration system (v19.0.0) transforms `profile` → `agents["claude-code"].profile` during install
- `saveConfig()` only writes the `agents` field (the legacy `profile` field is no longer written)
- `getAgentProfile({ config, agentName })` retrieves the profile for a specific agent from `agents[agentName].profile`

**Profile Lookup Pattern (CRITICAL):** Code that needs to read a profile MUST use `getAgentProfile({ config, agentName })` - never access agent profiles directly. The function returns the profile from `config.agents[agentName].profile` or null if not found.

The getConfigPath() function requires { installDir: string } and returns `<installDir>/.nori-config.json`. All config operations (loadConfig, saveConfig, validateConfig) require installDir as a parameter, ensuring consistent path resolution throughout the codebase. The `loadConfig()` function validates auth by checking for either refreshToken OR password (plus username and organizationUrl). The `saveConfig()` function prefers refreshToken over password - if both are provided, only refreshToken is saved. User preference fields (sendSessionTranscript, autoupdate) use the 'enabled' | 'disabled' type. The `sendSessionTranscript` field defaults to 'enabled' when not present. The `autoupdate` field defaults to 'disabled' when not present, requiring users to explicitly opt-in to automatic updates. These fields are loaded by loadConfig() with default fallback, persisted by saveConfig() when provided, and validated by the JSON schema. The config.ts module is used by both the installer (for managing installation settings) and hooks (for reading user preferences like session transcript opt-out or autoupdate disable).

**JSON Schema Validation Architecture:** The config.ts module uses JSON schema (via Ajv with ajv-formats) as the single source of truth for configuration validation. The schema defines:
- Field types and allowed values (enum constraints for sendSessionTranscript/autoupdate)
- Default values (sendSessionTranscript: "enabled", autoupdate: "disabled")
- URI format validation for organizationUrl
- Object structure for nested types (profile, agents, registryAuths, auth)
- `additionalProperties: false` to strip unknown fields
- Both legacy flat auth format (username/password at root) and new nested `auth` object format

The Ajv instance is configured with `useDefaults: true` (applies default values), `removeAdditional: true` (strips unknown properties), and ajv-formats for URI validation. A single compiled validator (`validateConfigSchema`) is used by both `loadConfig()` and `validateConfig()`.

**loadConfig() Validation Flow:**
1. Read and parse JSON from disk
2. Filter invalid registryAuths entries via `filterRegistryAuths()` (warns if entries are filtered)
3. Deep clone the config to avoid mutation during validation
4. Run JSON schema validation (applies defaults, strips unknown properties)
5. Transform validated data into the `Config` type with proper null handling
6. Build auth from either nested format (`auth: {...}`) or legacy flat format (fields at root)
7. Return null if schema validation fails (e.g., invalid enum values)

The `RawDiskConfig` type represents the JSON structure on disk after schema validation but before transformation to `Config`. This intermediate type provides type safety for the transformation logic. It includes both legacy flat auth fields (username/password/refreshToken/organizationUrl at root) and the new nested `auth` property for dual-format support. It also includes the legacy `profile` field for reading old configs, though this field is no longer written by `saveConfig()`.

**Auth Format (Nested vs Flat):** The canonical auth format uses a nested `auth` object:
```json
{ "auth": { "username": "...", "organizationUrl": "...", "refreshToken": "...", "password": null } }
```
The `saveConfig()` function always writes auth in this nested format. The `loadConfig()` function reads both formats for backwards compatibility:
- New nested format: `auth: { username, organizationUrl, refreshToken, password }`
- Legacy flat format: `username, password, refreshToken, organizationUrl` at root level (pre-v19.0.0)

When reading legacy flat format, `loadConfig()` constructs the nested auth structure internally so all downstream code works with the same `Config.auth` type.

**Registry Authentication:** The `registryAuths` field in Config is an array of `RegistryAuth` objects, each containing `username`, `password`, and `registryUrl`. This enables authentication for package registry operations like profile uploads. The `getRegistryAuth({ config, registryUrl })` helper function looks up credentials for a specific registry URL with trailing slash normalization. Registry auth is separate from the main Nori backend auth (`auth` field) - they use different Firebase projects and serve different purposes (registry operations vs. backend API access). The loadConfig() function validates registryAuths entries, filtering out any with missing required fields.

**Installed Agents Tracking:** Installed agents are derived from the keys of the `agents` object (e.g., `{"claude-code": {...}, "cursor-agent": {...}}` means both agents are installed). This enables multi-agent installations at the same location. Use `getInstalledAgents({ config })` helper to get the list. Key behaviors:
- During install: The config loader merges `agents` objects from both existing config and new config, so installing cursor-agent when claude-code is already installed results in both keys present
- During uninstall: The agent being uninstalled is removed from the `agents` object. If no agents remain, the config file is deleted. If other agents remain, the config is updated with the remaining agents
- Re-installing the same agent updates its config but does not create duplicates
- Legacy configs with only `profile` field (no `agents`) are converted by `loadConfig()` to `agents.claude-code.profile`, and the migration system transforms them during install

**Determining Paid vs Free Installation:** The `isPaidInstall({ config })` helper function determines whether a config represents a paid installation by checking if `config.auth != null`. Paid status is derived from the presence of auth credentials.

**loadConfig() installDir Resolution:** The loadConfig() function returns a Config object where the installDir field comes from the JSON file (if present) rather than exclusively from the function parameter. The parameter provides a default, but the function prioritizes `config.installDir` from the saved JSON file if it exists. This is critical because @/src/cli/features/claude-code/hooks/config/autoupdate.ts searches for the config file in parent directories - it must use the installDir from the config file itself, not the directory where the config was found. For example, if Nori was installed at `~/` but Claude Code is running from `~/foo/bar`, the config file is found at `~/.nori-config.json` (via ancestor search), but the actual installDir stored in that file is `~`, so the hook must use `~` as the installDir, not `~/foo/bar`.

Note: Hook scripts (autoupdate, summarize, etc.) use `process.cwd()` at runtime since they're called by Claude Code in the context of the user's project directory, but they search upward through parent directories to find the config file and read the true installDir from it.

### Things to Know

The installer modifies several Claude Code configuration files and directories: claude_desktop_config.json, CLAUDE.md, ~/.claude/hooks, ~/.claude/subagents, ~/.claude/slash-commands, ~/.claude/status-line, ~/.claude/profiles, ~/.claude/skills. Profiles are complete, self-contained directory structures at `<installDir>/.nori/profiles/{profileName}/` containing: CLAUDE.md (base instructions), nori.json (metadata), skills/ (skill directories with SKILL.md files), subagents/ (subagent .md files), slashcommands/ (slash command .md files). No built-in profiles are bundled with the package; profiles are obtained from the registry or created by users. All profiles are preserved across profile switches and upgrades. The CLAUDE.md managed block contains both the profile's base instructions AND a dynamically-generated skills list created by globbing for all SKILL.md files in the profile's skills/ directory and formatting them with paths, names, and descriptions from frontmatter. Configuration is stored in ~/nori-config.json with auth credentials and profile.baseProfile, checked by ConfigManager in @/src/api/base.ts. The installer is idempotent - running multiple times performs a clean uninstall of the previous version before installing the new version. Profile switching via /nori-switch-profile (implemented in @/src/cli/cli.ts) preserves auth credentials, sendSessionTranscript preference, and custom user profiles by calling installMain with skipUninstall=true, which bypasses the uninstall step entirely and updates profile.baseProfile in ~/nori-config.json. Changes to CLAUDE.md take effect in new conversations without requiring a Claude Code restart. Paid skills are prefixed with "paid-" in the source directory but installed without the prefix for paid tier users; free tier users skip paid- skills entirely. The build system (build.sh, bundle-skills.ts) bundles paid skill script.js files using esbuild to create standalone executables with all dependencies inlined, making them portable and executable from ~/.claude/skills/.

The installer creates an install-in-progress marker file at ~/.nori-install-in-progress at the start of installation (after tracking noriprof_install_started event) and deletes it on successful completion (after saveInstalledVersion). This marker contains the version being installed and is checked by the statusline to display error messages if installation fails. If the marker persists after 24 hours, the statusline suggests manual removal. This mechanism ensures users are notified of failed autoupdate installations via the statusline rather than silently having an incomplete installation.

Analytics tracking is non-blocking - all operations are wrapped in try/catch to ensure installation never fails due to analytics errors. The analytics system sends events to the Nori backend at `https://noriskillsets.dev/api/analytics/track` via `sendAnalyticsEvent()` in installTracking.ts. Events tracked include: `noriprof_install_started` and `noriprof_install_completed` (install command), `noriprof_uninstall_started` and `noriprof_uninstall_completed` (uninstall command), `claude_session_started` (tracked by autoupdate hook on SessionStart with metadata: tilework_cli_update_available), `noriprof_install_detected` (first install or version upgrade detected at CLI startup), and `noriprof_user_resurrected` (returning after 30+ days of inactivity). All events include `tilework_*` prefixed parameters for GA4 compliance: tilework_source, tilework_session_id, tilework_timestamp, tilework_cli_executable_name, tilework_cli_installed_version, tilework_cli_install_source, tilework_cli_days_since_install, tilework_cli_node_version. The `tilework_source` and `tilework_cli_executable_name` values are dynamically configured via `setTileworkSource()` in installTracking.ts - entry points call this at startup before any analytics operations to identify which CLI binary is being used (defaults to "nori-ai" for backwards compatibility). User ID is set from nori-config.json auth.username for paid users, null for free users. Helper functions `buildCLIEventParams()`, `buildBaseEventParams()`, `getTileworkSource()`, and `getUserId()` in installTracking.ts centralize parameter building for all callers.

Install lifecycle tracking (installTracking.ts) is called at CLI startup via `trackInstallLifecycle({ currentVersion })` to track: `noriprof_install_detected` (first installation or version upgrade), and `noriprof_user_resurrected` (returning after 30+ days of inactivity). State is persisted to `~/.nori/profiles/.nori-install.json` containing: schema_version, client_id (deterministic hash of hostname + username), opt_out flag, first_installed_at, last_updated_at, last_launched_at, installed_version, and install_source (detected from npm_config_user_agent). The install_source is updated on every startup to track package manager changes (npm/yarn/pnpm/bun). Analytics requests use a 5-second timeout with `unref()` to avoid blocking process exit. Users can opt out via the state file's `opt_out` field or the `NORI_NO_ANALYTICS=1` environment variable. CI environments are detected and flagged in the `is_ci` property. Version downgrades do not trigger events - only version upgrades trigger `noriprof_install_detected`.

**Test Isolation:** Tests that perform file operations pass a temp directory as installDir to all functions. Since all functions now require installDir as a parameter, tests can directly pass a temporary directory path rather than mocking process.env.HOME. Tests follow this pattern: (1) create temp directory using fs.mkdtemp() in beforeEach, (2) pass tempDir as installDir to all function calls, (3) clean up temp directory with fs.rm(tempDir, { recursive: true, force: true }) in afterEach. For example: `loadConfig({ installDir: tempDir })`, `getConfigPath({ installDir: tempDir })`, `hasExistingInstallation({ installDir: tempDir })`. This explicit parameter passing is safer than HOME mocking because it makes the file path dependency explicit and prevents any possibility of accidentally operating on real user files. Note that some tests still mock process.env.HOME for paid skill tests that use process.cwd() at runtime, but the core installer functions all use the explicit installDir parameter.

**Registrar CLI Commands:** The `registry-search`, `registry-download`, and `registry-upload` commands provide terminal access to Nori package registries for discovering, installing, and publishing profile packages. These commands use the `registrarApi` from @/src/api/registrar.ts (the same API used by slash commands). The `registry-search <query>` command searches for packages and displays results with names and descriptions. The search always queries the public registry (at `REGISTRAR_URL`) without authentication; if org auth is configured (`config.auth`), it also searches the org registry with authentication (org results displayed first). The `registry-download <package>[@version] [--registry <url>]` command downloads a package tarball and extracts it to `<installDir>/.claude/profiles/<packageName>/`. The download command supports optional version pinning via `package@1.0.0` syntax; without a version, it downloads the latest. Before downloading, it uses `getInstallDirs()` to locate the Nori installation (erroring if none found or if multiple exist without `--install-dir` specified). Extraction handles both gzipped and plain tarballs by checking for gzip magic bytes (0x1f 0x8b). If extraction fails, the target directory is cleaned up to avoid partial installations.

**Multi-Registry Download:** The `registry-download` command searches both the public registry (`REGISTRAR_URL`) and private registries configured in `config.registryAuths`. The public registry is always searched without authentication; private registries require auth credentials from the config and use `getRegistryAuthToken()` to obtain Firebase tokens. When a package is found in multiple registries, the command displays all matching registries with version/description and requires the user to specify `--registry <url>` to disambiguate. The `--registry` option allows downloading from a specific registry URL directly - for private registries, auth must be configured in `.nori-config.json` or an error is displayed. This behavior mirrors the `/nori-registry-download` slash command in @/src/cli/features/claude-code/hooks/config/intercepted-slashcommands/.

**Multi-Registry Upload:** The `registry-upload <profile>[@version] [--registry <url>]` command uploads a local profile to a configured registry. Unlike search and download (which query multiple registries), upload targets a SINGLE registry. The command requires registry authentication configured in `config.registryAuths`. When only one registry is configured, it uploads automatically. When multiple registries are configured and no `--registry` option is provided, the command displays an error listing available registries and example commands. The `--registry` option specifies the target registry URL - auth must be configured for that URL in `.nori-config.json`. Version defaults to "1.0.0" if not specified (e.g., `nori-ai registry-upload my-profile` uses 1.0.0, while `nori-ai registry-upload my-profile@2.0.0` uses 2.0.0). This behavior mirrors the `/nori-registry-upload` slash command in @/src/cli/features/claude-code/hooks/config/intercepted-slashcommands/.
