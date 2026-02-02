# Noridoc: commands

Path: @/src/cli/commands

### Overview

Contains all CLI command implementations for the nori-skillsets CLI. Each command lives in its own subdirectory with its implementation, tests, and any command-specific utilities co-located together.

### How it fits into the larger codebase

The CLI entry point (@/src/cli/nori-skillsets.ts) imports `registerXCommand` functions from each command subdirectory and calls them to register commands with the Commander.js program. Each command module exports a register function that accepts `{ program: Command }` and adds its command definition. Commands access global options (`--non-interactive`, `--silent`) via `program.opts()`. Business logic is encapsulated within each command directory - the entry points only handle routing.

Commands that interact with agent-specific features (install, switch-profile) use the AgentRegistry (@/src/cli/features/agentRegistry.ts) to look up the claude-code agent implementation. The agent provides access to its LoaderRegistry, environment paths, and global feature declarations.

**Installation Flow Architecture:** The installation process is split into three steps orchestrated by install.ts:

```
nori-skillsets install (orchestrator)
    |
    +-- init        (Step 1: Set up directories and config)
    |
    +-- onboard     (Step 2: Select profile and configure auth)
    |
    +-- loaders     (Step 3: Run feature loaders to install components)
```

The `install` command in @/src/cli/commands/registry-install/registryInstall.ts is a high-level wrapper that downloads from the public registrar and then runs `noninteractive()` from install.ts. The `install.ts` module in @/src/cli/commands/install/ contains the `noninteractive()` function which orchestrates init, onboard, and loader execution.

**init** (@/src/cli/commands/init/init.ts): Creates the `.nori` directory structure and initializes `.nori-config.json`. If existing Claude Code config exists and no Nori config is present, captures the existing config as a profile:
  - Non-interactive mode: auto-captures as "my-skillset"

**onboard** (@/src/cli/commands/onboard/onboard.ts): Configures the profile selection and auth credentials:
- Non-interactive mode requires `--profile` flag if no existing profile is set

**Agent Support:** The AgentRegistry only supports `"claude-code"` as a valid agent. Agent resolution uses `AgentRegistry.getInstance().get({ name: "claude-code" })` to obtain the agent implementation. The agent provides its own LoaderRegistry with agent-specific loaders.

The install command sets `agents: { [agentName]: { profile } }` in the config, where the keys of the `agents` object indicate which agents are installed. The config loader merges `agents` objects with any existing config.

**install.ts Architecture:** The install.ts module contains only the `noninteractive()` flow and the `main()` entry point. The `noninteractive()` function orchestrates: (1) `initMain()`, (2) `onboardMain()`, (3) `completeInstallation()` which runs feature loaders, tracks analytics, and displays completion banners. The `main()` function wraps `noninteractive()` with silent mode support.

**cliCommandNames.ts:** The `CliName` type is a single literal `"nori-skillsets"` (not a union). The `getCommandNames()` function returns the `NORI_SKILLSETS_COMMANDS` constant, which maps logical command names (download, search, switchProfile, etc.) to their CLI command strings.

**Login/Logout:** The `login` command authenticates users with the Nori backend via Firebase:
1. Prompts for email and password (or accepts `--email` and `--password` flags in non-interactive mode)
2. Authenticates via Firebase SDK
3. Calls `/api/auth/check-access` to verify organization access and retrieve organization list
4. Saves auth credentials (refreshToken, organizationUrl, organizations, isAdmin) to config

The `logout` command removes auth credentials from config, preserving the profile selection and other settings.

**Registry Commands:** The `registry-search`, `registry-download`, and `registry-install` commands provide terminal access to Nori package registries. These commands use the `registrarApi` from @/src/api/registrar.ts. Registry commands work without any agent gate -- they operate on the profiles directory structure independently of which agent is installed.

**Namespace-Based Download:** The `registry-download` command uses package namespaces to determine the target registry. Unnamespaced packages (e.g., `my-skillset`) are downloaded from the public registry without authentication. Namespaced packages (e.g., `myorg/my-skillset`) use `buildOrganizationRegistryUrl({ orgId })` to derive the registry URL and require unified auth.

### Core Implementation

**Command Naming Convention:** The nori-skillsets CLI uses simplified names without `registry-` prefix for read operations. The `noriSkillsetsCommands.ts` module defines register functions that create Commander commands with simplified names while delegating to the full implementation functions.

**switch-profile** (@/src/cli/commands/switch-profile/profiles.ts): The `switchSkillsetAction` function handles profile switching. It loads the config, validates the profile exists using the agent's `listProfiles()` method, then calls `noninteractive()` from install.ts to re-run the full installation with the new profile. The re-run picks up the new profile and applies it through all loaders.

**watch** (@/src/cli/commands/watch/): Monitors Claude Code sessions by tailing transcript files. Supports `watch` (start) and `watch stop` (stop daemon).

### Things to Know

- `asciiArt.ts` in the install directory contains ASCII banners displayed during installation. Display functions (displayNoriBanner, displayWelcomeBanner, displaySeaweedBed) check `isSilentMode()` and return early without output when silent mode is enabled.
- Registry download supports both gzipped and plain tarballs by checking for gzip magic bytes (0x1f 0x8b).
- The `skill-download` command (@/src/cli/commands/skill-download/) downloads individual skills and updates both `skills.json` and `nori.json` manifests in the target profile.
- The `external` command (@/src/cli/commands/external/) installs skills directly from GitHub repositories. It clones the repo, discovers SKILL.md files, and installs them following the same dual-installation pattern as `skill-download` (live copy to `~/.claude/skills/` with template substitution, raw copy to profile's `skills/` directory). Writes a `nori.json` provenance file (instead of `.nori-version`) to track the GitHub source URL, ref, subpath, and installation timestamp. See @/src/cli/commands/external/docs.md for details.
- The `registry-install` command combines `registry-download` with `noninteractive()` install to provide a single-step "download and activate" flow from the public registrar.
- The `registry-search` command always queries the public registry without authentication; if org auth is configured, it also searches the org registry with authentication (org results displayed first).

Created and maintained by Nori.
