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
  - Non-interactive mode: auto-captures as "my-skillset"
- When a profile is captured, init performs three additional steps:
  - Deletes the original `~/.claude/CLAUDE.md` to prevent content duplication (the content was already captured to the profile with managed block markers)
  - Sets the captured profile as active by writing `agents.claude-code.profile.baseProfile` to config
  - Applies the managed block to `~/.claude/CLAUDE.md` by calling `claudeMdLoader.install()`
- Idempotent: preserves existing config fields (auth, agents) while updating version

**Onboard Command:** The onboard command (@/src/cli/commands/onboard/onboard.ts) handles profile and auth selection:
- Requires init to have been run first (config must exist)
- Prompts for Nori Web authentication (email, password, organization ID) or allows skipping
- Displays available profiles from installed profiles in `~/.nori/profiles/` (obtained via `agent.listProfiles()`)
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


The uninstall command uses the `agent.getGlobalLoaders()` method to obtain global loader metadata (loader names and human-readable names) for displaying in uninstall prompts and for determining which loaders to skip when preserving global settings.

Each agent declares its own global features (e.g., claude-code has hooks, statusline, and global slash commands; cursor-agent has hooks and slash commands). If an agent has no global features, the global settings prompt is skipped entirely.

The install command sets `agents: { [agentName]: { profile } }` in the config, where the keys of the `agents` object indicate which agents are installed. The config loader merges `agents` objects with any existing config. The uninstall command prompts the user to select which agent to uninstall when multiple agents are installed at a location (in interactive mode).

**Install Non-Interactive Profile Requirement:** Non-interactive installs require either an existing configuration with a profile OR the `--profile` flag. This requirement is enforced by the onboard command. When no existing config is found, the onboard command errors with a helpful message listing available profiles and example usage. Example: `nori-ai install --non-interactive --profile my-skillset`.

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
- `skill-download` - Download and install skills directly to `.claude/skills/{skill-name}/` in the target directory. Supports namespaced package specs for org-specific downloads (see below). Creates `.nori-version` file for version tracking. Persists raw skill files to the active profile's `skills/` directory and applies template substitution to the live copy. Supports `--list-versions`, `--registry`, and `--skillset` options.
- `skill-upload` - Upload skills from `~/.claude/skills/` to a registry. Auto-bumps patch version when no version specified. Extracts description from SKILL.md frontmatter.

Skills follow the same tarball-based upload/download pattern as profiles. Downloaded skills go to both `.claude/skills/` (live copy with template substitution applied) and `~/.nori/profiles/<profile>/skills/` (raw copy for persistence across profile switches). Skills require a SKILL.md file (with optional YAML frontmatter containing name and description).

**skill-download Namespaced Packages:** The `skill-download` command supports namespaced package specifications for organization-scoped skills. The package spec format is `[org/]skill-name[@version]`:
- `my-skill` - downloads from public registry to `.claude/skills/my-skill/`
- `my-skill@1.0.0` - downloads specific version from public registry
- `myorg/my-skill` - downloads from `https://myorg.noriskillsets.dev` to `.claude/skills/my-skill/`
- `myorg/my-skill@1.0.0` - downloads specific version from org registry

The command uses `parseNamespacedPackage()` from @/src/utils/url.ts to extract the org ID, package name, and optional version. It then uses `buildOrganizationRegistryUrl()` to derive the target registry URL from the org ID. For authentication, the command checks `config.auth.organizations` (unified auth) to verify the user has access to the specified org's registry.

**skill-download Flat Installation:** Unlike profiles which nest by org (`~/.nori/profiles/myorg/my-skillset/`), skills install to a flat directory (`~/.claude/skills/my-skill/`) regardless of namespace. This maintains backward compatibility with the Claude Code skills directory structure.

**skill-download Org Collision Warning:** When installing a skill from a different org than the currently installed version (tracked via `orgId` in `.nori-version`), the command warns the user about the overwrite. For example, installing `myorg/my-skill` over a previously installed `my-skill` (from public registry) will display a warning.

**skill-download Namespace/Registry Conflict:** If user specifies both a namespace (`myorg/skill`) and `--registry`, the command errors since they are mutually exclusive - the namespace determines the registry automatically.

**Authentication Commands:** Two commands manage authentication for the nori-skillsets CLI:
- `login` - Authenticates with noriskillsets.dev using email/password or Google SSO (`--google`), stores credentials in `.nori-config.json`
- `logout` - Clears stored authentication credentials from config

**Login Command Flow:** The login command (@/src/cli/commands/login/login.ts) authenticates users against noriskillsets.dev via two flows: email/password (default) and Google SSO (`--google` flag). Both flows produce the same Firebase credentials and store identical config fields, so the entire downstream pipeline (token refresh, registry auth, logout) works unchanged regardless of which flow was used.

The `--google` flag is mutually exclusive with `--email` and `--password` -- the command rejects the combination with an error.

*Email/password flow (default):*
1. Prompts for email and password (or accepts `--email` and `--password` flags in non-interactive mode)
2. Authenticates with Firebase using `signInWithEmailAndPassword()`

*Google SSO flow (`--google`):*
1. The Google OAuth helper module (@/src/cli/commands/login/googleAuth.ts) implements the localhost HTTP server callback pattern (same pattern used by firebase-tools, gcloud CLI)
2. Finds an available port starting from 9876 (tries up to 10 ports), generates a cryptographic CSRF state nonce, and builds the Google OAuth authorization URL
3. Starts a temporary HTTP server on localhost to capture the OAuth callback, then opens the user's browser to Google's consent screen via the `open` npm package (falls back to printing the URL if browser launch fails)
4. The local server validates the CSRF state parameter, extracts the authorization code, and serves a success/error HTML page to the browser. The server has a 2-minute timeout
5. Exchanges the authorization code for Google tokens via `https://oauth2.googleapis.com/token` using the Desktop app OAuth client credentials
6. Calls Firebase `signInWithCredential()` with `GoogleAuthProvider.credential(idToken)` to obtain Firebase credentials

*After authentication (both flows):*
1. Calls `https://noriskillsets.dev/api/auth/check-access` with the Firebase ID token to fetch user's organizations and admin status
2. Stores credentials in `.nori-config.json`:
   - `auth.username` - User's email
   - `auth.refreshToken` - Firebase refresh token for session persistence
   - `auth.organizationUrl` - Defaults to `https://noriskillsets.dev`
   - `auth.organizations` - Array of organization IDs the user has access to (for private registry operations)
   - `auth.isAdmin` - Whether the user has admin privileges
3. Preserves existing config fields (agents, autoupdate, registryAuths, etc.) when logging in

The login command provides helpful error messages based on Firebase AuthErrorCodes (invalid credentials, user not found, too many attempts, network errors). For Google SSO specifically, it handles `auth/operation-not-allowed` (Google sign-in not enabled) and `Authentication denied` (user rejected consent).

**Logout Command Flow:** The logout command (@/src/cli/commands/logout/logout.ts) clears authentication:
1. Loads existing config
2. If no auth credentials exist, displays "Not currently logged in" and exits
3. Saves config without auth fields, preserving other config fields (agents, autoupdate, version)

**skill-download No Installation Required:** Unlike other registry commands, `skill-download` does not require a prior Nori installation. The installation directory resolution:
1. If `--install-dir` is provided: uses that directory as the target
2. If existing Nori installation found via `getInstallDirs()`: uses that installation's directory
3. If no installation found: uses the current working directory (cwd) as the target

The command creates `.claude/skills/` directory if it doesn't exist. This allows users to simply drop skills into any directory without running `nori-ai init` or `nori-ai install` first. Config is loaded only for private registry authentication (if it exists).

**skill-download Manifest Update:** When a skill is downloaded, the command automatically adds it to both the profile's `skills.json` and `nori.json` manifests. The target profile is determined by:
1. `--skillset <name>` option - explicitly specifies which profile to update
2. Active profile from config - if no `--skillset` is provided, uses the currently active profile
3. No manifest update - if neither is available, the skill downloads but no manifests are updated

The skill is added with version `"*"` (always latest). Two manifests are updated:
- **`skills.json`**: Updated via `addSkillDependency()` from @/src/cli/features/claude-code/profiles/skills/resolver.ts. Used by the skill loader/resolver for dependency tracking.
- **`nori.json`**: Updated via `addSkillToNoriJson()` from @/src/cli/features/claude-code/profiles/metadata.ts. Adds the skill to `dependencies.skills` in the canonical profile manifest. If `nori.json` does not exist, it is auto-created using the profile directory basename and version `"1.0.0"`.

Both manifest update failures are non-blocking - the skill download succeeds even if either manifest cannot be written.

**skill-download Profile Persistence:** After extracting a skill to `~/.claude/skills/<name>/`, the command copies the raw (unsubstituted) skill files to the active profile's skills directory at `~/.nori/profiles/<profile>/skills/<name>/`. This ensures skills survive profile switches, because the skills loader (@/src/cli/features/claude-code/profiles/skills/loader.ts) wipes `~/.claude/skills/` entirely during install and rebuilds it from the profile's `skills/` directory. The profile is determined the same way as for manifest updates (`--skillset` option or active profile from config). If no profile is available, the profile copy is skipped. Profile copy failures emit a warning but do not fail the download.

**skill-download Template Substitution:** After persisting raw files to the profile, the command applies template substitution to all `.md` files in the live copy (`~/.claude/skills/<name>/`). This replaces template variables like `{{skills_dir}}`, `{{install_dir}}`, etc. with actual paths using `substituteTemplatePaths()` from @/src/cli/features/claude-code/template.ts. The profile copy retains raw template variables so they can be re-substituted during future installs. The complete download flow is:

1. Extract tarball to `~/.claude/skills/<name>/` (live location)
2. Write `.nori-version` file for update tracking
3. Copy raw files to `~/.nori/profiles/<profile>/skills/<name>/` (profile persistence)
4. Apply template substitution to `.md` files in the live copy
5. Update `skills.json` manifest
6. Update `nori.json` `dependencies.skills`

**Upload Commands Registry Resolution:** Both `registry-upload` (for profiles) and `skill-upload` (for skills) use the same registry resolution logic:
1. **Public registry (default):** When the user has unified auth (`config.auth`) with a `refreshToken`, the public registry (`https://noriskillsets.dev`) is automatically included as an available upload target. This is the default when no `--registry` flag is provided.
2. **Organization registries:** When the user has unified auth with `organizations`, organization-specific registries are derived from `buildOrganizationRegistryUrl()` and included alongside the public registry.
3. **Explicit registry:** Users can specify `--registry <url>` to target a specific registry. The command checks `availableRegistries` first (which includes the public registry for authenticated users), then falls back to `getRegistryAuth()` for org-based auth lookups.
4. **Multiple registries:** If multiple registries are configured and no `--registry` is specified, the command prompts the user to select one (or errors in non-interactive mode).

**registry-download Auto-Init:** The `registry-download` command (and `nori-skillsets download`) automatically initializes Nori configuration when no installation exists, allowing users to download profiles without first running `nori-ai init` or `nori-ai install`. The installation directory resolution logic:
1. If `--install-dir` is provided but no installation exists there: calls `initMain({ installDir, nonInteractive: false })` to set up at that location
2. If no `--install-dir`: prefers `~/.nori` if it exists (since that directory typically has registry auth configured via `nori-skillsets login`)
3. Falls back to `getInstallDirs()` from current directory if `~/.nori` doesn't exist
4. If no existing installations found: calls `initMain({ installDir: cwd, nonInteractive: false })` to set up at current directory
5. If multiple installations found: errors with a list of installations and prompts user to specify with `--install-dir`

This `~/.nori` preference mirrors the same logic in `registry-search` and ensures authenticated operations (especially for namespaced packages like `org/profile-name`) use the config that has registry credentials.

By using `nonInteractive: false`, the auto-init triggers the interactive existing config capture flow - users with an existing `~/.claude/` configuration (CLAUDE.md, skills, agents, commands) must provide a profile name to save it before proceeding (or abort with Ctrl+C).

This differs from `registry-install`, which calls the full `installMain()` (orchestrating init, onboard, and loaders). The `registry-download` command only calls `initMain()` because download just places profile files without activating them - the user still needs to run `switch-profile` to activate the downloaded profile.

**registry-download Namespaced Packages:** The `registry-download` command supports namespaced package specifications for organization-scoped packages. The package spec format is `[org/]package-name[@version]`:
- `my-skillset` - downloads from public registry to `~/.nori/profiles/my-skillset/`
- `myorg/my-skillset` - downloads from `https://myorg.noriskillsets.dev` to `~/.nori/profiles/myorg/my-skillset/`

The command uses `parseNamespacedPackage()` from @/src/utils/url.ts to extract the org ID, package name, and optional version from the package spec. It then uses `buildOrganizationRegistryUrl()` to derive the target registry URL from the org ID. For authentication, the command checks `config.auth.organizations` (unified auth) to verify the user has access to the specified org's registry. If the user is not logged in (no unified auth), the command errors with a message prompting the user to log in via `nori-ai login`. Unnamespaced packages (public registry) do not require authentication.

**registry-upload Namespaced Packages:** The `registry-upload` command supports the same namespaced package specification format for uploading to organization registries. The profile directory structure mirrors the package namespace:
- `my-skillset` - uploads from `~/.nori/profiles/my-skillset/` to public registry
- `myorg/my-skillset` - uploads from `~/.nori/profiles/myorg/my-skillset/` to `https://myorg.noriskillsets.dev`

When using unified auth, the command derives the target registry from the package namespace automatically. When no explicit `--registry` is provided and the user has unified auth with organizations, the command uploads to the org's registry matching the package namespace.

**registry-download Skill Dependencies:** The `registry-download` command automatically installs skill dependencies declared in a profile's `nori.json` manifest. After extracting a profile tarball, the command checks for a `nori.json` file with a `dependencies.skills` field (mapping skill names to version strings). For each declared skill:
1. Fetches the skill packument via `registrarApi.getSkillPackument()` to get the latest version
2. Checks if the already-installed version equals the latest version (skips download if so)
3. Downloads and extracts the skill tarball to the profile's own skills directory (`~/.nori/profiles/{profile-name}/skills/{skill-name}/`)
4. Writes a `.nori-version` file for version tracking

Skills always download the latest version - version ranges in `nori.json` are currently ignored but reserved for future use. Skills are downloaded from the same registry (with same auth token) as the profile being installed. Skill download failures are non-blocking - the command warns but continues with profile installation. Skills are stored in the profile's directory to keep profiles self-contained. The `nori.json` format supports externalized skills:
```json
{ "name": "profile-name", "version": "1.0.0", "dependencies": { "skills": { "skill-name": "*" } } }
```

**Watch Command:** The `watch` command (@/src/cli/commands/watch/) monitors Claude Code sessions and saves transcripts to `~/.nori/transcripts/`. It runs as a background daemon that watches `~/.claude/projects/` for JSONL file changes and copies them to organized transcript storage. See @/src/cli/commands/watch/docs.md for details.

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

nori-skillsets.ts (simplified CLI for registry read operations, skill downloads, profile switching, initialization, authentication, session watching, and installation location detection)
  |
  +-- registerNoriSkillsetsInitCommand({ program })          --> commands/noriSkillsetsCommands.ts --> initMain
  +-- registerNoriSkillsetsSearchCommand({ program })        --> commands/noriSkillsetsCommands.ts --> registrySearchMain
  +-- registerNoriSkillsetsDownloadCommand({ program })      --> commands/noriSkillsetsCommands.ts --> registryDownloadMain
  +-- registerNoriSkillsetsInstallCommand({ program })       --> commands/noriSkillsetsCommands.ts --> registryInstallMain
  +-- registerNoriSkillsetsSwitchSkillsetCommand({ program })--> commands/noriSkillsetsCommands.ts --> switchSkillsetAction
  +-- registerNoriSkillsetsDownloadSkillCommand({ program }) --> commands/noriSkillsetsCommands.ts --> skillDownloadMain
  +-- registerNoriSkillsetsWatchCommand({ program })         --> commands/noriSkillsetsCommands.ts --> watchMain
  +-- registerNoriSkillsetsLoginCommand({ program })         --> commands/noriSkillsetsCommands.ts --> loginMain
  +-- registerNoriSkillsetsLogoutCommand({ program })        --> commands/noriSkillsetsCommands.ts --> logoutMain
  +-- registerNoriSkillsetsInstallLocationCommand({ program })--> commands/noriSkillsetsCommands.ts --> installLocationMain
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

The `noriSkillsetsCommands.ts` file contains thin command wrappers for the nori-skillsets CLI - registration functions that provide simplified command names (`init`, `search`, `download`, `install`, `switch-skillset`, `download-skill`, `watch`) by delegating to the underlying implementation functions (`*Main` functions from init, registry-*, skill-*, and watch commands, `switchSkillsetAction` for switch-skillset). Upload, update, and onboard commands are only available via the nori-ai CLI. Each wrapper passes `cliName: "nori-skillsets"` to the `*Main` functions so user-facing messages display nori-skillsets command names (e.g., "run nori-skillsets switch-skillset" instead of "run nori-ai switch-profile"). This allows the nori-skillsets CLI to use cleaner command names while sharing all business logic with the nori-ai CLI.

The `install/` directory contains command-specific utilities:
- `asciiArt.ts` - ASCII banners displayed during installation. All display functions (displayNoriBanner, displayWelcomeBanner, displaySeaweedBed) check `isSilentMode()` and return early without output when silent mode is enabled.
- `installState.ts` - Helper to check for existing installations (wraps version.ts)
- `existingConfigCapture.ts` - Detects and captures existing Claude Code configurations as named profiles. The `detectExistingConfig()` function scans `~/.claude/` for CLAUDE.md, skills directory, agents directory, and commands directory. The `promptForExistingConfigCapture()` function displays what was found and requires the user to provide a valid profile name (lowercase alphanumeric with hyphens) - the user cannot decline and must either provide a name or abort with Ctrl+C. The `captureExistingConfigAsProfile()` function creates a profile directory at `~/.nori/profiles/<profileName>/` with: nori.json (unified manifest format with skill dependencies), CLAUDE.md (with managed block markers added if not present), and copies of skills/, agents/ (renamed to subagents/), and commands/ (renamed to slashcommands/).

**Install Command Silent Mode:** The `main()` function in install.ts accepts a `silent` parameter. When `silent: true`, the function calls `setSilentMode({ silent: true })` before execution and restores it to false in a `finally` block to prevent state leakage. Silent mode implies non-interactive mode. This is used by intercepted slash commands (e.g., `/nori-switch-profile` in both claude-code and cursor-agent) that call `installMain()` and need clean stdout to return JSON responses without corruption from installation messages like ASCII art banners.

The install command uses `agent.listProfiles({ installDir })` to get available profiles from the user's installed profiles directory. Since no built-in profiles are shipped with the package, only profiles downloaded from the registry or created by users are shown.

The `install-location/` command displays Nori installation directories found in the current directory and parent directories. The `nori-skillsets` CLI version (via `registerNoriSkillsetsInstallLocationCommand`) adds installation type classification, supporting `--installation-source` (show only directories with `.nori-config.json`) and `--installation-managed` (show only directories with managed CLAUDE.md block) flags. The `--non-interactive` global flag outputs plain paths one per line for scripting. The command uses `getInstallDirsWithTypes()` from @/src/utils/path.ts to classify installations as "source", "managed", or "both" - installations of type "both" appear in both filtered views. The `nori-ai` version uses the simpler `getInstallDirs()` without type classification.

Tests within each command directory use the same temp directory isolation pattern as other tests in the codebase, passing `installDir` explicitly to functions rather than mocking `process.env.HOME`.

Created and maintained by Nori.
