# Noridoc: commands

Path: @/src/cli/commands

### Overview

Contains all CLI command implementations for the nori-skillsets CLI. Each command lives in its own subdirectory with its implementation, tests, and any command-specific utilities co-located together.

### How it fits into the larger codebase

The CLI entry point (@/src/cli/nori-skillsets.ts) imports `registerXCommand` functions from each command subdirectory and calls them to register commands with the Commander.js program. Each command module exports a register function that accepts `{ program: Command }` and adds its command definition. Commands access global options (`--install-dir`, `--non-interactive`, `--agent`) via `program.opts()`. Business logic is encapsulated within each command directory - the entry points only handle routing.

Commands that interact with agent-specific features (install, switch-profile) use the AgentRegistry (@/src/cli/features/agentRegistry.ts) to look up the agent implementation by name. The agent provides access to its LoaderRegistry, environment paths, and global feature declarations. Commands pass the `--agent` option through their call chain to ensure consistent agent context.

**Installation Flow Architecture:** The installation process is split into three steps orchestrated by install.ts:

```
nori-skillsets install (orchestrator)
    |
    +-- init        (Step 1: Set up directories and config)
    |
    +-- onboard     (Step 2: Select profile and configure auth)
    |
    +-- loaders     (Step 3: Run feature loaders to install components)
    |
    +-- manifest    (Step 4: Write installation manifest for change detection)
```

The `install` command in @/src/cli/commands/registry-install/registryInstall.ts is a high-level wrapper that downloads from the public registrar and then runs `noninteractive()` from install.ts. The `install.ts` module in @/src/cli/commands/install/ contains the `noninteractive()` function which orchestrates init, onboard, and loader execution. After loaders complete, `writeInstalledManifest()` creates a manifest of all installed files in `~/.claude/` for later change detection by `switch-skillset`.

**init** (@/src/cli/commands/init/init.ts): Creates the `.nori` directory structure and initializes `.nori-config.json`. If existing Claude Code config exists and no Nori config is present, captures the existing config as a profile:
  - Non-interactive mode: auto-captures as "my-skillset"

**onboard** (@/src/cli/commands/onboard/onboard.ts): Configures the profile selection and auth credentials:
- Non-interactive mode requires `--profile` flag if no existing profile is set

**Multi-Agent Support:** The `--agent` flag defaults to `"claude-code"` and determines which agent's loaders run during installation. Agent resolution uses `AgentRegistry.getInstance().get({ name: agentName })` to obtain the agent implementation. Each agent provides its own LoaderRegistry with agent-specific loaders.

The install command sets `agents: { [agentName]: { profile } }` in the config, where the keys of the `agents` object indicate which agents are installed. The config loader merges `agents` objects with any existing config.

**install.ts Architecture:** The install.ts module contains only the `noninteractive()` flow and the `main()` entry point. The `noninteractive()` function orchestrates: (1) `initMain()`, (2) `onboardMain()`, (3) `completeInstallation()` which runs feature loaders, writes the installation manifest, tracks analytics, and displays completion banners. The `main()` function wraps `noninteractive()` with silent mode support.

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

3. **Headless Mode** (`--google --no-localhost` flags):
   - For environments where SSH port forwarding isn't possible, uses a hosted callback page at `https://noriskillsets.dev/oauth/callback`
   - Uses a separate Web Application OAuth client (`GOOGLE_OAUTH_WEB_CLIENT_ID`) instead of the Desktop client; the client secret is kept server-side on `noriskillsets.dev`
   - Instead of starting a localhost server, the server handles the OAuth code-to-token exchange and displays the resulting `id_token` for copy-paste
   - The CLI prompts the user to paste this token directly, which is then used with `GoogleAuthProvider.credential()` to sign in to Firebase (no client-side token exchange needed)

After authentication (either method):
- Calls `/api/auth/check-access` to verify organization access and retrieve organization list
- Saves auth credentials (refreshToken, organizationUrl, organizations, isAdmin) to config

The `logout` command removes auth credentials from config, preserving the profile selection and other settings. When no `--install-dir` is provided, logout auto-detects all config locations with auth credentials by searching both `<searchDir>/.nori-config.json` and `<searchDir>/.nori/.nori-config.json` (the home directory installation pattern stores config in the `.nori` subdirectory). Auth is cleared from all detected locations.

**Registry Commands:** The `registry-search`, `registry-download`, and `registry-install` commands provide terminal access to Nori package registries. These commands use the `registrarApi` from @/src/api/registrar.ts. Registry commands work without any agent gate -- they operate on the profiles directory structure independently of which agent is installed.

**Namespace-Based Download:** The `registry-download` command uses package namespaces to determine the target registry. Unnamespaced packages (e.g., `my-skillset`) are downloaded from the public registry without authentication. Namespaced packages (e.g., `myorg/my-skillset`) use `buildOrganizationRegistryUrl({ orgId })` to derive the registry URL and require unified auth.

### Core Implementation

**Command Naming Convention:** The nori-skillsets CLI uses simplified names without `registry-` prefix for read operations. The `noriSkillsetsCommands.ts` module defines register functions that create Commander commands with simplified names while delegating to the full implementation functions.

**install-location** (@/src/cli/commands/install-location/): Displays all Nori installation directories found from cwd upward. Supports `--installation-source` (source dirs only), `--installation-managed` (managed dirs only), and `--non-interactive` (plain output for scripts). Uses `getInstallDirs({ currentDir: process.cwd() })` to discover installations.

**switch-profile** (@/src/cli/commands/switch-profile/profiles.ts): The `switchSkillsetAction` function handles profile switching with local change detection:

1. **Detect local changes**: Calls `detectLocalChanges()` which reads the installation manifest from `~/.nori/installed-manifest.json` and compares current `~/.claude/` file hashes against stored hashes
2. **Handle changes** (if detected):
   - In non-interactive mode: throws an error (safe default prevents data loss)
   - In interactive mode: displays modified/added/deleted files and prompts user to choose:
     - Proceed anyway (changes will be lost)
     - Save current config as new skillset first (uses `captureExistingConfigAsProfile()`)
     - Abort
3. **Confirm switch**: Prompts user to confirm the skillset switch
4. **Execute switch**: Calls `noninteractive()` from install.ts to re-run the full installation with the new profile

The change detection uses the manifest module from @/src/cli/features/claude-code/profiles/manifest.ts.

**watch** (@/src/cli/commands/watch/): Monitors Claude Code sessions by tailing transcript files. Supports `watch` (start) and `watch stop` (stop daemon).

### Things to Know

- `asciiArt.ts` in the install directory contains ASCII banners displayed during installation. Display functions (displayNoriBanner, displayWelcomeBanner, displaySeaweedBed) check `isSilentMode()` and return early without output when silent mode is enabled.
- Registry download supports both gzipped and plain tarballs by checking for gzip magic bytes (0x1f 0x8b).
- The `skill-download` command (@/src/cli/commands/skill-download/) downloads individual skills and updates both `skills.json` and `nori.json` manifests in the target profile.
- The `external` command (@/src/cli/commands/external/) installs skills directly from GitHub repositories. It clones the repo, discovers SKILL.md files, and installs them following the same dual-installation pattern as `skill-download` (live copy to `~/.claude/skills/` with template substitution, raw copy to profile's `skills/` directory). Writes a `nori.json` provenance file (instead of `.nori-version`) to track the GitHub source URL, ref, subpath, and installation timestamp. See @/src/cli/commands/external/docs.md for details.
- The `registry-install` command combines `registry-download` with `noninteractive()` install to provide a single-step "download and activate" flow from the public registrar.
- The `registry-search` command always queries the public registry without authentication; if org auth is configured, it also searches the org registry with authentication (org results displayed first).
- Google OAuth uses Desktop app client credentials; the client secret is not truly secret (same as firebase-tools, gcloud CLI, etc.). CSRF protection uses a cryptographic nonce (`generateState()`) verified in the callback.
- Installation manifest is only written for the `claude-code` agent; other agents do not track installed files for change detection.
- Manifest writing failures are non-fatal and do not block installation.

Created and maintained by Nori.
