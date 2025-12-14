# Noridoc: commands

Path: @/src/cli/commands

### Overview

Contains all CLI command implementations for the nori-ai CLI. Each command lives in its own subdirectory with its implementation, tests, and any command-specific utilities co-located together.

### How it fits into the larger codebase

The main CLI entry point (@/src/cli/cli.ts) imports `registerXCommand` functions from each command subdirectory and calls them to register commands with the Commander.js program. Each command module exports a register function that accepts `{ program: Command }` and adds its command definition. Commands access global options (`--install-dir`, `--non-interactive`, `--agent`) via `program.opts()`. Business logic is encapsulated within each command directory - cli.ts only handles routing.

Commands that interact with agent-specific features (install, uninstall, check, switch-profile) use the AgentRegistry (@/src/cli/features/agentRegistry.ts) to look up the agent implementation by name. The agent provides access to its LoaderRegistry, environment paths, and global feature declarations. Commands pass the `--agent` option through their call chain to ensure consistent agent context.

**switch-profile Agent Resolution:** The switch-profile command (@/src/cli/commands/switch-profile/profiles.ts) defines `--agent` as both a global option AND a local subcommand option, allowing `nori-ai switch-profile senior-swe --agent cursor-agent` syntax (local option takes precedence). The `resolveAgent()` function determines which agent to use:
- If `--agent` is explicitly provided: use that agent
- If no agents installed: default to `claude-code`
- If exactly one agent installed: auto-select it
- If multiple agents installed (interactive mode): prompt user to select from numbered list
- If multiple agents installed (non-interactive mode): throw error with helpful message listing installed agents

**switch-profile Confirmation:** After agent resolution, the switch-profile command prompts the user to confirm before proceeding. The `confirmSwitchProfile()` function displays:
- Install directory being operated on
- Agent display name and ID (e.g., "Claude Code (claude-code)")
- Current profile (read from agent-specific config or legacy format, or "(none)" if not set)
- New profile being switched to

The user must enter "y" or "Y" to proceed; any other input cancels the operation. In non-interactive mode (`--non-interactive`), confirmation is skipped to allow automated/scripted usage.

The uninstall command uses two agent methods for global features:
- `agent.getGlobalFeatureNames()`: Human-readable names for displaying in prompts (e.g., "hooks, statusline, and global slash commands")
- `agent.getGlobalLoaderNames()`: Loader names for determining which loaders to skip when preserving global settings (e.g., `["hooks", "statusline", "slashcommands"]`)

Each agent declares its own global features (e.g., claude-code has hooks, statusline, and global slash commands; cursor-agent has hooks and slash commands). If an agent has no global features, the global settings prompt is skipped entirely.

The install command sets `agents: { [agentName]: { profile } }` in the config, where the keys of the `agents` object indicate which agents are installed. The config loader merges `agents` objects with any existing config. The uninstall command prompts the user to select which agent to uninstall when multiple agents are installed at a location (in interactive mode).

**Install Non-Interactive Profile Requirement:** Non-interactive installs require either an existing configuration with a profile OR the `--profile` flag. When no existing config is found, the install command errors with a helpful message listing available profiles and example usage. This prevents silent assignment of default profiles - users must explicitly choose. Profile is resolved by checking (in order): agent-specific profile (`config.agents[agentName].profile`), then top-level profile (`config.profile`), then the explicit `--profile` flag. The first non-null value is used. Example: `nori-ai install --non-interactive --profile senior-swe`.

**Install Agent-Specific Uninstall Logic:** The install command only runs uninstall cleanup when reinstalling the SAME agent (upgrade scenario). When installing a different agent (e.g., cursor-agent when claude-code is already installed), it skips uninstall to preserve the existing agent's installation. The logic:
1. Reads config at start to get installed agents via `getInstalledAgents({ config })` (keys of `agents` object)
2. For backwards compatibility: if no agents are installed but an installation exists (detected via hasExistingInstallation), assumes `["claude-code"]` (old installs didn't track agents)
3. Only runs uninstall if the agent being installed is already installed
4. Logs "Adding new agent (preserving existing X installation)..." when installing a different agent alongside existing ones
5. The `getInstalledVersion()` call is made ONLY inside the `if (!skipUninstall && agentAlreadyInstalled)` block - this ensures the function is only called when an installation is known to exist, since `getInstalledVersion()` throws an error if the config has no `version` field

**Uninstall Agent Detection:** In non-interactive mode (used during upgrades), the uninstall command auto-detects the agent from config when `--agent` is not explicitly provided. It uses `getInstalledAgents({ config })` to determine installed agents from the `agents` object keys. If exactly one agent is installed, it uses that agent; otherwise it defaults to `claude-code`. This ensures the correct agent is uninstalled during autoupdate scenarios without requiring explicit `--agent` flags in older installed versions.

**Check Agent Detection:** The check command auto-detects the agent from config when `--agent` is not explicitly provided. Agent resolution occurs AFTER config loading (since the config is needed for detection). Logic:
- If `--agent` explicitly provided: use that agent
- If exactly one agent installed: auto-select it
- If multiple agents installed: error with "Multiple agents installed (X, Y). Please specify which agent to check with --agent <name>."
- If no agents in config (legacy fallback): default to `claude-code`

**Registry Commands Agent Validation:** Registry commands (search, download, update, upload) require Claude Code to be installed because profiles are stored at `~/.claude/profiles/`. The shared `registryAgentCheck.ts` module provides validation:
- `checkRegistryAgentSupport({ installDir })` - Returns `{ supported: boolean, config: Config | null }`. Rejects if config has cursor-agent but NOT claude-code; allows all other cases (backwards compatible with older installs that have no agents field)
- `showCursorAgentNotSupportedError()` - Displays error message explaining registry requires Claude Code and how to install it

All four registry commands call this validation early in their main function, after determining the install directory but before any registry API calls:
```typescript
const agentCheck = await checkRegistryAgentSupport({ installDir });
if (!agentCheck.supported) {
  showCursorAgentNotSupportedError();
  return;
}
```

```
cli.ts
  |
  +-- registerInstallCommand({ program })      --> commands/install/install.ts
  +-- registerUninstallCommand({ program })    --> commands/uninstall/uninstall.ts
  +-- registerCheckCommand({ program })        --> commands/check/check.ts
  +-- registerSwitchProfileCommand({ program })--> commands/switch-profile/profiles.ts
  +-- registerInstallLocationCommand({ program })--> commands/install-location/installLocation.ts
  +-- registerRegistrySearchCommand({ program })--> commands/registry-search/registrySearch.ts
  +-- registerRegistryDownloadCommand({ program })--> commands/registry-download/registryDownload.ts
  +-- registerRegistryUploadCommand({ program })--> commands/registry-upload/registryUpload.ts
```

Commands use shared utilities from the parent @/src/cli/ directory:
- `config.ts` - Config type and persistence (with per-agent profile support)
- `logger.ts` - Unified logging via Winston. All console output uses these functions: `error()`, `success()`, `info()`, `warn()` for formatted messages; `newline()` for blank line spacing; `raw({ message })` for pre-formatted output (ASCII art, separators). Silent mode via `setSilentMode()`/`isSilentMode()` suppresses all console output while file logging to `/tmp/nori.log` continues. The `debug({ message })` function writes to file only (no console).
- `prompt.ts` - User input prompting
- `version.ts` - Version tracking for upgrades and CLI flag compatibility checking
- `analytics.ts` - GA4 event tracking

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
- `registryAgentCheck.ts` - Shared validation for registry commands. Checks if the installation has only cursor-agent (no claude-code) and rejects with a helpful error message. Used by registry-search, registry-download, registry-update, and registry-upload commands.

The `install/` directory contains command-specific utilities:
- `asciiArt.ts` - ASCII banners displayed during installation. All display functions (displayNoriBanner, displayWelcomeBanner, displaySeaweedBed) check `isSilentMode()` and return early without output when silent mode is enabled.
- `installState.ts` - Helper to check for existing installations (wraps version.ts)
- `registryAuthPrompt.ts` - Prompts for private registry authentication during interactive install. Collects registry URL, username, and password (hidden input). Supports preserving existing registryAuths from config and adding multiple registries. Uses `RegistryAuth` type from `@/cli/config.js`.

**Install Command Silent Mode:** The `main()` function in install.ts accepts a `silent` parameter. When `silent: true`, the function calls `setSilentMode({ silent: true })` before execution and restores it to false in a `finally` block to prevent state leakage. Silent mode implies non-interactive mode. This is used by intercepted slash commands (e.g., `/nori-switch-profile` in both claude-code and cursor-agent) that call `installMain()` and need clean stdout to return JSON responses without corruption from installation messages like ASCII art banners.

The install command uses `agent.listSourceProfiles()` to get available profiles from the package source directory, combined with `agent.listProfiles({ installDir })` to include any user-installed profiles. This ensures each agent displays its own profiles (claude-code shows amol, senior-swe, etc.; cursor-agent shows its own profiles).

The `install-location/` command was extracted from inline definition in cli.ts to follow the same pattern as other commands.

Tests within each command directory use the same temp directory isolation pattern as other tests in the codebase, passing `installDir` explicitly to functions rather than mocking `process.env.HOME`.

Created and maintained by Nori.
