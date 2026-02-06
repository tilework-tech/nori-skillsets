# Noridoc: cli

Path: @/src/cli

### Overview

CLI for Nori Profiles that installs features into Claude Code, manages credentials, and tracks installation analytics via Google Analytics, with directory-based profile system. The CLI uses Commander.js for command routing, argument parsing, and help generation.

### How it fits into the larger codebase

**CLI Architecture:** The package provides a single CLI binary (defined in @/package.json bin):

| Binary | Entry Point | Purpose |
|--------|-------------|---------|
| `nori-skillsets` | @/src/cli/nori-skillsets.ts | CLI with all commands for Nori Profiles installation, management, and registry operations |

The CLI uses Commander.js for command routing, argument parsing, validation, and help generation. It defines global options (`--install-dir`, `--non-interactive`, `--silent`, `--agent`) on the main program. Each command lives in its own subdirectory under @/src/cli/commands/ and exports a `registerXCommand({ program })` function that the entry point imports and calls. Commands access global options via `program.opts()`. The CLI provides automatic `--help`, `--version`, and unknown command detection. Running the binary with no arguments shows help. The CLI layer is responsible ONLY for parsing and routing - all business logic remains in the command modules. The entry point configures analytics tracking by calling `setTileworkSource()` and `trackInstallLifecycle()` at startup before any commands are registered, setting source to "nori-skillsets" to identify CLI usage in analytics data.

**Global Options:**

| Option | Description |
|--------|-------------|
| `-d, --install-dir <path>` | Custom installation directory (default: current working directory) |
| `-n, --non-interactive` | Run without interactive prompts |
| `-s, --silent` | Suppress all output (implies non-interactive) |
| `-a, --agent <name>` | AI agent to use (auto-detected from config, or claude-code) |

**Directory Structure:**

```
src/cli/
  nori-skillsets.ts      # CLI entry point
  config.ts              # Unified config management (auth + profile + preferences)
  env.ts                 # Environment and path utilities (re-exports from features/claude-code/paths.ts)
  logger.ts              # Console output formatting via Winston
  version.ts             # Version tracking for upgrades + package root discovery
  installTracking.ts     # Install lifecycle and session tracking to Nori backend
  features/              # Agent abstraction layer (see @/src/cli/features/docs.md)
    agentRegistry.ts     # AgentRegistry singleton + shared Loader/LoaderRegistry types
    config/              # Shared config loader (used by all agents)
    claude-code/         # Claude Code agent implementation (see @/src/cli/features/claude-code/docs.md)
  commands/              # Command implementations (see @/src/cli/commands/docs.md)
    install/             # Install command + asciiArt, installState utilities
    init/                # Initialize Nori configuration and directories
    switch-profile/      # Profile switching command
    install-location/    # Display installation directories
    registry-search/     # Search for skillsets and skills in registrar
    registry-download/   # Download from registrar
    registry-install/    # Download + install + activate from public registrar
    skill-download/      # Download a skill from registrar
    external/            # Install skills from external GitHub repos
    watch/               # Monitor Claude Code sessions and save transcripts
    factory-reset/       # Remove all agent configuration
```

**CLI Commands:**

| Command | Module | Description |
|---------|--------|-------------|
| `init` | commands/init/init.ts | Initialize Nori configuration and directories |
| `install` | commands/registry-install/registryInstall.ts | Download, install, and activate a skillset from the public registrar |
| `search` | commands/registry-search/registrySearch.ts | Search registries for packages |
| `download` | commands/registry-download/registryDownload.ts | Download a skillset from registrar |
| `download-skill` | commands/skill-download/skillDownload.ts | Download a skill from registrar |
| `external` | commands/external/external.ts | Install skills from an external GitHub repository |
| `switch-skillset` | commands/switch-profile/profiles.ts | Switch the active skillset |
| `list-skillsets` | commands/list-skillsets/ | List available skillsets |
| `login` | commands/login/ | Authenticate with Nori backend |
| `logout` | commands/logout/ | Remove authentication credentials |
| `watch` | commands/watch/ | Monitor Claude Code sessions and save transcripts |
| `install-location` | commands/install-location/ | Display installation directories |
| `factory-reset` | commands/factory-reset/factoryReset.ts | Remove all agent configuration from the ancestor tree |

The nori-skillsets CLI uses simplified command names (no `registry-` prefix for registry read operations, `download-skill` for skill downloads, `switch-skillset` for profile switching, `init` for initialization, and `watch` for session monitoring). The commands are defined in @/src/cli/commands/noriSkillsetsCommands.ts and delegate to the underlying implementation functions (`*Main` functions from registry-*, skill-*, watch, and init commands, plus `switchSkillsetAction` from profiles.ts).

Each command directory contains the command implementation, its tests, and any command-specific utilities (e.g., `install/` contains `asciiArt.ts` and `installState.ts`).

**Installation Flow:** The installer (install.ts) orchestrates the installation process in non-interactive mode. It runs: (1) `initMain()` to set up directories and config, (2) inline profile resolution — loads existing config, resolves profile from `--profile` flag or existing agent config, preserves auth credentials, and saves merged config via `saveConfig()`, (3) runs feature loaders from the agent's LoaderRegistry. The installer creates `<installDir>/.nori-config.json` containing auth credentials and selected profile name, and installs components into `<installDir>/.claude/`. By default, installDir is `process.cwd()`, so running `cd /project && npx nori-skillsets init` creates files in `/project/`. The profile selection determines which complete directory structure (CLAUDE.md, skills/, subagents/, slashcommands/) gets installed from the user's profiles directory at `<installDir>/.nori/profiles/{profileName}/`. Each profile is a self-contained directory with a CLAUDE.md file that defines the profile. Profiles are obtained from the registry or created by users; no built-in profiles are bundled with the package. The installTracking.ts module tracks installation and session events to the Nori backend.

**installDir Architecture:** The codebase follows a strict pattern where `installDir` is a required parameter for all internal functions. CLI entry points are the ONLY places that accept optional installDir. These entry points either call normalizeInstallDir() from @/src/utils/path.ts or use getInstallDirs() to auto-detect installations. The `installDir` is the BASE directory (e.g., `/home/user/project`), NOT the `.claude` directory. All files are stored relative to this base:
- `<installDir>/.nori-config.json` - config file with version tracking (via getConfigPath)
- `<installDir>/.claude/` - Claude Code configuration (via getClaudeDir)

This ensures that when running `cd /foo/bar && npx nori-skillsets init`, all files are created in `/foo/bar/` rather than the user's home directory.

**Config Migration During Install:** The installation flow uses the `loadAndMigrateConfig({ installDir })` helper early in the flow. This helper:
1. Loads the existing config via `loadConfig()`
2. If no config exists (first-time install), returns null and skips migration
3. If config exists but has no `version` field, attempts fallback to deprecated `.nori-installed-version` file
4. Calls `migrate()` from @/src/cli/features/migration.ts to apply any necessary migrations based on the config's version
5. Returns the migrated config for use in the installation flow

The version.ts module manages version tracking for installation upgrades and CLI flag compatibility. Version is stored as a `version` field in `.nori-config.json`. The `getInstalledVersion()` function reads from the config file via `loadConfig()`, with fallback to the deprecated `.nori-installed-version` file. The `getCurrentPackageVersion()` function reads the version from the package.json by using `findPackageRoot()` to walk up from the current file's directory looking for a package.json with the valid Nori package name (`nori-skillsets`). The `VALID_PACKAGE_NAMES` constant contains only `["nori-skillsets"]`.

**Version Compatibility Checking:** The version.ts module provides CLI flag compatibility checking via `supportsAgentFlag({ version })`. The `--agent` flag was introduced in version 19.0.0 with multi-agent support.

The logger.ts module provides console output formatting with ANSI color codes, powered by the Winston logging library. Standard logging functions (error, success, info, warn, debug) use colors.RED, colors.GREEN, colors.CYAN, colors.YELLOW respectively. All log output is appended to `/tmp/nori.log` for debugging.

**Silent Mode:** The logger module provides `setSilentMode({ silent: boolean })` and `isSilentMode()` functions for controlling console output globally. When silent mode is enabled, the custom ConsoleTransport skips all console output while Winston's File transport continues logging to `/tmp/nori.log`. Silent mode is set/restored in a `finally` block by the install command's `main()` function to prevent state leakage.

The config.ts module provides a unified `Config` type for both disk persistence and runtime use. The `Config` type contains: auth credentials via `AuthCredentials` type (username, organizationUrl, refreshToken, password), agents (per-agent configuration - keys indicate installed agents, each with their own profile), user preferences (sendSessionTranscript, autoupdate), and the required installDir field.

**AuthCredentials Type:** Supports both token-based and legacy password-based authentication:
- `username` and `organizationUrl` - required for all authenticated installs
- `refreshToken` - preferred, secure token-based auth (Firebase refresh token)
- `password` - legacy, deprecated (will be removed in future)
- `organizations` - array of organization IDs the user has access to (populated by login command from `/api/auth/check-access`)
- `isAdmin` - whether the user has admin privileges for their organization

**transcriptDestination Config Field:** The `Config` type includes an optional `transcriptDestination` field that specifies which organization should receive transcript uploads. This is stored as an org ID string (e.g., `"myorg"`) which maps to a registry URL (e.g., `https://myorg.noriskillsets.dev`). The watch daemon sets this field on first run when the user selects a destination organization. This allows users with access to multiple private organizations to control where their transcripts are uploaded, independent of the `organizationUrl` used for authentication.

**Agent Config Structure:** The config supports per-agent profiles via the `agents` field, a `Record<ConfigAgentName, AgentConfig>` where only "claude-code" is currently valid. The keys of the `agents` object serve as the source of truth for which agents are installed. Use `getInstalledAgents({ config })` helper to get the list of installed agents.

**Profile Lookup Pattern (CRITICAL):** Code that needs to read a profile MUST use `getAgentProfile({ config, agentName })` - never access agent profiles directly. The function returns the profile from `config.agents[agentName].profile` or null if not found.

The getConfigPath() function requires { installDir: string } and returns `<installDir>/.nori-config.json`. All config operations (loadConfig, saveConfig, validateConfig) require installDir as a parameter, ensuring consistent path resolution throughout the codebase.

**JSON Schema Validation Architecture:** The config.ts module uses JSON schema (via Ajv with ajv-formats) as the single source of truth for configuration validation. The Ajv instance is configured with `useDefaults: true` (applies default values), `removeAdditional: true` (strips unknown properties), and ajv-formats for URI validation. A single compiled validator (`validateConfigSchema`) is used by both `loadConfig()` and `validateConfig()`.

**Auth Format (Nested vs Flat):** The canonical auth format uses a nested `auth` object. The `saveConfig()` function always writes auth in this nested format. The `loadConfig()` function reads both formats for backwards compatibility with pre-v19.0.0 configs.

**Installed Agents Tracking:** Installed agents are derived from the keys of the `agents` object. Use `getInstalledAgents({ config })` helper to get the list.

**loadConfig() installDir Resolution:** The loadConfig() function returns a Config object where the installDir field comes from the JSON file (if present) rather than exclusively from the function parameter. The parameter provides a default, but the function prioritizes `config.installDir` from the saved JSON file if it exists. This is critical because hook scripts (like autoupdate.ts) search for the config file in parent directories - they must use the installDir from the config file itself, not the directory where the config was found.

**CliName Type:** The `CliName` type in @/src/cli/commands/cliCommandNames.ts is a single literal type `"nori-skillsets"` (not a union). The `getCommandNames()` function always returns the same `NORI_SKILLSETS_COMMANDS` constant regardless of input.

### Things to Know

The installer modifies several Claude Code configuration files and directories: CLAUDE.md, ~/.claude/hooks, ~/.claude/subagents, ~/.claude/slash-commands, ~/.claude/status-line, ~/.claude/profiles, ~/.claude/skills. Profiles are complete, self-contained directory structures at `<installDir>/.nori/profiles/{profileName}/` containing: CLAUDE.md (base instructions), nori.json (metadata), skills/ (skill directories with SKILL.md files), subagents/ (subagent .md files), slashcommands/ (slash command .md files). No built-in profiles are bundled with the package; profiles are obtained from the registry or created by users.

The installer creates an install-in-progress marker file at ~/.nori-install-in-progress at the start of installation and deletes it on successful completion. This marker contains the version being installed and is checked by the statusline to display error messages if installation fails.

Analytics tracking is non-blocking - all operations are wrapped in try/catch to ensure installation never fails due to analytics errors. The analytics system sends events to the Nori backend at `https://noriskillsets.dev/api/analytics/track` via `sendAnalyticsEvent()` in installTracking.ts. Events tracked include: `noriprof_install_started` and `noriprof_install_completed` (install command), `claude_session_started` (tracked by autoupdate hook on SessionStart), `noriprof_install_detected` (first install or version upgrade detected at CLI startup), and `noriprof_user_resurrected` (returning after 30+ days of inactivity). All events include `tilework_*` prefixed parameters for GA4 compliance. The `tilework_source` and `tilework_cli_executable_name` values are dynamically configured via `setTileworkSource()` in installTracking.ts - the entry point calls this at startup with `"nori-skillsets"`.

Install lifecycle tracking (installTracking.ts) is called at CLI startup via `trackInstallLifecycle({ currentVersion })`. State is persisted to `~/.nori/profiles/.nori-install.json` containing: schema_version, client_id (deterministic hash of hostname + username), opt_out flag, timestamps, installed_version, and install_source. Analytics requests use a 5-second timeout with `unref()` to avoid blocking process exit. Users can opt out via the state file's `opt_out` field or the `NORI_NO_ANALYTICS=1` environment variable.

**installTracking.ts default tileworkSource:** The default value of `tileworkSource` is `"nori-skillsets"`. The `setTileworkSource()` is called by the CLI entry point, but the default ensures correct behavior even before explicit initialization.

**Test Isolation:** Tests that perform file operations pass a temp directory as installDir to all functions. Since all functions now require installDir as a parameter, tests can directly pass a temporary directory path rather than mocking process.env.HOME.

Created and maintained by Nori.
