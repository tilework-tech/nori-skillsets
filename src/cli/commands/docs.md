# Noridoc: commands

Path: @/src/cli/commands

### Overview

Contains all CLI command implementations for the nori-skillsets CLI. Each command lives in its own subdirectory with its implementation, tests, and any command-specific utilities co-located together.

### How it fits into the larger codebase

The CLI entry point (@/src/cli/nori-skillsets.ts) imports `registerXCommand` functions from each command subdirectory and calls them to register commands with the Commander.js program. Each command module exports a register function that accepts `{ program: Command }` and adds its command definition. Commands access global options (`--install-dir`, `--non-interactive`, `--agent`) via `program.opts()`. Business logic is encapsulated within each command directory - the entry points only handle routing.

Commands that interact with agent-specific features (install, switch-profile) use the AgentRegistry (@/src/cli/features/agentRegistry.ts) to look up the agent implementation by name. The agent provides access to its LoaderRegistry, environment paths, and global feature declarations. Commands pass the `--agent` option through their call chain to ensure consistent agent context.

**Installation Flow Architecture:** The installation process is orchestrated by install.ts:

```
nori-skillsets install (orchestrator)
    |
    +-- init        (Step 1: Set up directories and config)
    |
    +-- resolve profile + save config (Step 2: Profile resolution inline in install.ts)
    |
    +-- loaders     (Step 3: Run feature loaders to install components)
    |
    +-- manifest    (Step 4: Write installation manifest for change detection)
```

The `install` command in @/src/cli/commands/registry-install/registryInstall.ts is a high-level wrapper that downloads from the public registrar and then runs `noninteractive()` from install.ts. The `install.ts` module in @/src/cli/commands/install/ contains the `noninteractive()` function which orchestrates init, profile resolution, and loader execution. After loaders complete, `writeInstalledManifest()` creates a manifest of all installed files in `~/.claude/` for later change detection by `switch`.

**init** (@/src/cli/commands/init/init.ts): Creates the `.nori` directory structure and initializes `.nori-config.json`. If existing Claude Code config exists and no Nori config is present, captures the existing config as a profile:
  - Non-interactive mode: auto-captures as "my-skillset"
  - Experimental UI mode (`--experimental-ui`): Uses `initFlow` from @/cli/prompts/flows for a polished interactive experience with intro/outro, note boxes, and modern prompts. The flow handles ancestor checks, existing config detection, profile name capture, persistence warnings, and initialization spinner. Legacy readline-based prompts are bypassed when experimental UI is enabled.

**Profile Resolution (in install.ts):** After init, `noninteractive()` loads the existing config, resolves the profile from the `--profile` flag or the existing agent config, preserves auth credentials, and saves the merged config. Non-interactive mode requires `--profile` flag if no existing profile is set.

**Multi-Agent Support:** The `--agent` flag defaults to `"claude-code"` and determines which agent's loaders run during installation. Agent resolution uses `AgentRegistry.getInstance().get({ name: agentName })` to obtain the agent implementation. Each agent provides its own LoaderRegistry with agent-specific loaders.

The install command sets `agents: { [agentName]: { profile } }` in the config, where the keys of the `agents` object indicate which agents are installed. The config loader merges `agents` objects with any existing config.

**install.ts Architecture:** The install.ts module contains only the `noninteractive()` flow and the `main()` entry point. The `noninteractive()` function orchestrates: (1) `initMain()`, (2) inline profile resolution and config save via `loadConfig()`/`saveConfig()`, (3) `completeInstallation()` which runs feature loaders, writes the installation manifest, tracks analytics, and displays completion banners. The `main()` function wraps `noninteractive()` with silent mode support.

**cliCommandNames.ts:** The `CliName` type is a single literal `"nori-skillsets"` (not a union). The `getCommandNames()` function returns the `NORI_SKILLSETS_COMMANDS` constant, which maps logical command names (download, search, switchProfile, etc.) to their CLI command strings.

**Login/Logout:** The `login` command authenticates users with the Nori backend via Firebase. It supports three modes:

1. **Interactive Email/Password** (default):
   - Uses `loginFlow` from @/cli/prompts to provide a complete interactive experience
   - Shows intro message ("Login to Nori Skillsets")
   - Groups email and password prompts together using @clack/prompts group()
   - Displays spinner during authentication
   - Shows organization info in a note box (if user has orgs)
   - Shows outro message on success
   - The flow uses a callbacks pattern: loginFlow handles UI while the command provides onAuthenticate callback for Firebase auth and API calls

2. **Non-interactive Email/Password** (`--email` and `--password` flags):
   - Bypasses loginFlow and authenticates directly via Firebase SDK
   - Uses standard logger output instead of @clack/prompts UI

3. **Google SSO** (`--google` flag):
   - Uses the localhost OAuth callback pattern: starts a temporary HTTP server on an available port (9876-9885), opens the browser to Google's consent screen, and captures the authorization code via redirect
   - `isHeadlessEnvironment()` in googleAuth.ts detects SSH/headless environments by checking for `SSH_TTY`, `SSH_CONNECTION`, or `SSH_CLIENT` environment variables
   - Always displays the OAuth URL before attempting to open the browser, enabling manual copy-paste in environments where browser opening fails
   - In SSH environments, displays port forwarding instructions: `ssh -L <port>:localhost:<port> <user>@<server>`
   - With `--no-localhost` flag, uses a hosted callback page at `https://noriskillsets.dev/oauth/callback` for environments where SSH port forwarding isn't possible
   - All Google SSO functions (`authenticateWithGoogle`, `authenticateWithGoogleLocalhost`, `authenticateWithGoogleHeadless`) accept an `experimentalUi` parameter; when enabled, output uses `@clack/prompts` constructs (`note()`, `log.info()`, `log.warn()`, `spinner()`, `promptPassword()`) instead of legacy logger calls (`info()`, `warn()`, `newline()`, `promptUser()`)

4. **Headless Mode** (`--google --no-localhost` flags):
   - For environments where SSH port forwarding isn't possible, uses a hosted callback page at `https://noriskillsets.dev/oauth/callback`
   - Uses a separate Web Application OAuth client (`GOOGLE_OAUTH_WEB_CLIENT_ID`) instead of the Desktop client; the client secret is kept server-side on `noriskillsets.dev`
   - Instead of starting a localhost server, the server handles the OAuth code-to-token exchange and displays the resulting `id_token` for copy-paste
   - The CLI prompts the user to paste this token directly, which is then used with `GoogleAuthProvider.credential()` to sign in to Firebase (no client-side token exchange needed)

5. **Experimental UI** (`--experimental-ui` flag):
   - When enabled, `loginMain` presents an auth method selection using `@clack/prompts` `select()` with Email/Password and Google SSO options
   - Email/Password selection delegates to the existing `loginFlow` (with `skipIntro: true` since the experimental UI already showed `intro()`)
   - Google SSO selection routes through `authenticateWithGoogle` with `experimentalUi: true`, which propagates to the localhost and headless sub-flows
   - After Google SSO authentication, organization and admin info are displayed via `note()` with an "Account Info" title, and login completion uses `outro()` instead of the legacy `success()` logger
   - The `--no-localhost` flag validation is relaxed when `experimentalUi` is true (since the user can select Google SSO from the interactive menu without passing `--google`)
   - Headless environment confirmation uses `@clack/prompts` `confirm()` (via `confirmAction`) instead of the legacy `promptYesNo`

After authentication (either method):
- Calls `/api/auth/check-access` to verify organization access and retrieve organization list
- Saves auth credentials (refreshToken, organizationUrl, organizations, isAdmin) to config

The `logout` command removes auth credentials from the centralized `~/.nori-config.json`, preserving the profile selection and other settings. The `logoutMain` function loads the single centralized config via `loadConfig()` (zero-arg), clears the `auth` field, and saves back via `saveConfig()`.

**Registry Commands:** The `registry-search`, `registry-download`, `registry-upload`, and `registry-install` commands provide terminal access to Nori package registries. These commands use the `registrarApi` from @/src/api/registrar.ts. Registry commands work without any agent gate -- they operate on the profiles directory structure independently of which agent is installed.

**Namespace-Based Download:** The `registry-download` command uses package namespaces to determine the target registry. Unnamespaced packages (e.g., `my-skillset`) are downloaded from the public registry without authentication. Namespaced packages (e.g., `myorg/my-skillset`) use `buildOrganizationRegistryUrl({ orgId })` to derive the registry URL and require unified auth.

**Namespace-Based Upload:** The `registry-upload` command (@/src/cli/commands/registry-upload/) mirrors `registry-download` for publishing profiles. It uses the same namespace-based registry resolution: unnamespaced packages target the public registry, namespaced packages (e.g., `myorg/my-skillset`) target the organization registry. Authentication is always required for uploads. The command supports:
- Auto version bumping: If no version is specified via `@version` syntax, auto-increments the patch version of the latest published version (or starts at 1.0.0 if first publish)
- Explicit versioning: Specify exact version with `profile@1.2.3` syntax
- Version listing: `--list-versions` flag shows all published versions without uploading
- Registry override: `--registry <url>` flag uploads to a specific registry URL
- Skill collision detection and auto-resolution: When skills in the profile conflict with existing skills in the registry, unchanged skills are automatically linked to existing versions; modified skills require manual resolution (rename or coordinate with skill owner)

### Core Implementation

**Command Naming Convention:** The nori-skillsets CLI uses simplified names without `registry-` prefix for read operations. The `noriSkillsetsCommands.ts` module defines register functions that create Commander commands with simplified names while delegating to the full implementation functions. Several commands also register hidden aliases as separate Commander commands (using `{ hidden: true }` so they do not appear in `--help` output). These aliases handle singular/plural variants and long-form names, all delegating to the same action handler as the canonical command. For example, `switch` (canonical) has hidden aliases `switch-skillset` and `switch-skillsets` (long-form), `list` (canonical) has hidden aliases `list-skillsets` and `list-skillset` (long-form), and `edit` (canonical) has a hidden alias `edit-skillset` (long-form).

**install-location** (@/src/cli/commands/install-location/): Displays all Nori installation directories found from cwd upward. Supports `--installation-source` (source dirs only), `--installation-managed` (managed dirs only), and `--non-interactive` (plain output for scripts). Uses `getInstallDirs({ currentDir: process.cwd() })` to discover installations.

**switch-profile** (@/src/cli/commands/switch-profile/profiles.ts): The `switchSkillsetAction` function handles profile switching with local change detection:

1. **Detect local changes**: Calls `detectLocalChanges()` which reads the installation manifest from `~/.nori/installed-manifest.json` and compares current `~/.claude/` file hashes against stored hashes
2. **Handle changes** (if detected):
   - With `--force` flag: skips change handling entirely and proceeds (discards local changes)
   - In non-interactive mode (without `--force`): throws an error (safe default prevents data loss)
   - In interactive mode: displays modified/added/deleted files and prompts user to choose:
     - Proceed anyway (changes will be lost)
     - Save current config as new skillset first (uses `captureExistingConfigAsProfile()`)
     - Abort
3. **Confirm switch**: Prompts user to confirm the skillset switch
4. **Execute switch**: Calls `noninteractive()` from install.ts to re-run the full installation with the new profile

The change detection uses the manifest module from @/src/cli/features/claude-code/profiles/manifest.ts.

**watch** (@/src/cli/commands/watch/): Monitors Claude Code sessions by tailing transcript files. Supports `watch` (start) and `watch stop` (stop daemon).

**completion** (@/src/cli/commands/completion/): Generates shell completion scripts for Bash and Zsh. `completionMain` routes the `<shell>` argument to `generateBashCompletion()` or `generateZshCompletion()`, which return static script strings printed to stdout. Users activate completions via `eval "$(nori-skillsets completion bash)"` or the zsh equivalent. The generated scripts handle static completions (subcommands, per-command flags) inline, and dynamic completions for `switch` by calling back to `nori-skillsets list 2>/dev/null` at tab-completion time. All three binary names (`nori-skillsets`, `nori-skillset`, `sks`) are registered for completion. Hidden command aliases (`switch-skillset`, `switch-skillsets`, `list-skillsets`, `list-skillset`, `fork-skillset`, `edit-skillset`) are excluded from completion candidates.

**fork** (@/src/cli/commands/fork-skillset/forkSkillset.ts): The `forkSkillsetMain` function copies an existing skillset directory to a new name under `~/.nori/profiles/`. Validates the source is a valid skillset by checking for `nori.json` (using the same `MANIFEST_FILE` constant from @/src/cli/features/managedFolder.ts used by `listProfiles()`), validates the destination does not already exist, creates parent directories for namespaced profiles (e.g., `org/name`), and copies recursively via `fs.cp`. The primary command is `fork` with a hidden alias `fork-skillset`, following the same alias pattern as other commands.

**new** (@/src/cli/commands/new-skillset/newSkillset.ts): The `newSkillsetMain` function creates a new empty skillset directory under `~/.nori/profiles/`. Validates the destination does not already exist (via `fs.access`), creates parent directories for namespaced profiles (e.g., `org/name`), and writes `nori.json` via `writeProfileMetadata()` from @/src/cli/features/claude-code/profiles/metadata.ts (with `path.basename(name)` as the name and version `"1.0.0"`). The `nori.json` file serves as the skillset marker for `listProfiles()`. The primary command is `new` with a hidden alias `new-skillset`. Follows the same pattern as `fork` but creates from scratch rather than copying an existing skillset.

**factory-reset** (@/src/cli/commands/factory-reset/factoryReset.ts): The `factoryResetMain` function removes all configuration for a given agent. It blocks non-interactive mode (prints an error and returns), looks up the agent by name via `AgentRegistry.getInstance().get({ name })`, checks that the agent supports `factoryReset`, and delegates to the agent's `factoryReset({ path })` method. Defaults `path` to `process.cwd()` if not provided. This follows the same pattern as `switch` for refusing destructive operations in non-interactive mode.

**dir** (@/src/cli/commands/dir/dir.ts): Opens the Nori profiles directory (`~/.nori/profiles`) in the system file explorer. In non-interactive mode, outputs the plain path to stdout for scripting use. In interactive mode, spawns the platform-specific open command (`open` on macOS, `xdg-open` on Linux) as a detached process so the CLI can exit immediately while the file explorer remains open. Falls back to printing the path if spawning fails. Uses `@clack/prompts` output (`log.success`, `log.step`, `outro`) for interactive feedback.

**edit-skillset** (@/src/cli/commands/edit-skillset/editSkillset.ts): The `editSkillsetMain` function opens a skillset's profile directory in VS Code, or falls back to printing the path and directory contents with manual instructions. When given an optional `name` argument, it opens that specific profile; otherwise it reads the active profile from config via `loadConfig()` + `getAgentProfile()`. The profile directory is resolved via `getNoriProfilesDir()` (i.e., `~/.nori/profiles/<profileName>/`). VS Code launch uses `child_process.execFile('code', [path])`. Supports the `--agent` flag for multi-agent setups and namespaced profile names (e.g., `myorg/my-profile`).

### Things to Know

- `asciiArt.ts` in the install directory contains ASCII banners displayed during installation. Display functions (displayNoriBanner, displayWelcomeBanner, displaySeaweedBed) check `isSilentMode()` and return early without output when silent mode is enabled.
- Registry download supports both gzipped and plain tarballs by checking for gzip magic bytes (0x1f 0x8b).
- The `skill-download` command (@/src/cli/commands/skill-download/) downloads individual skills and updates both `skills.json` and `nori.json` manifests in the target profile.
- The `external` command (@/src/cli/commands/external/) installs skills directly from GitHub repositories. It clones the repo, discovers SKILL.md files, and installs them following the same dual-installation pattern as `skill-download` (live copy to `~/.claude/skills/` with template substitution, raw copy to profile's `skills/` directory). Supports `--new <name>` to create a brand-new skillset and install skills into it in a single step, or `--skillset <name>` to target an existing one. Writes a `nori.json` provenance file (instead of `.nori-version`) to track the GitHub source URL, ref, subpath, and installation timestamp. See @/src/cli/commands/external/docs.md for details.
- The `registry-install` command combines `registry-download` with `noninteractive()` install to provide a single-step "download and activate" flow from the public registrar.
- The `registry-search` command always queries the public registry without authentication; if org auth is configured, it also searches the org registry with authentication (org results displayed first).
- The `registry-upload` command creates a gzipped tarball from the local profile directory before uploading. Skill collision errors from the API include conflict metadata (skillId, latestVersion, owner, contentUnchanged, availableActions) that enables auto-resolution for unchanged skills.
- Google OAuth uses Desktop app client credentials; the client secret is not truly secret (same as firebase-tools, gcloud CLI, etc.). CSRF protection uses a cryptographic nonce (`generateState()`) verified in the callback.
- Installation manifest is only written for the `claude-code` agent; other agents do not track installed files for change detection.
- Manifest writing failures are non-fatal and do not block installation.

Created and maintained by Nori.
