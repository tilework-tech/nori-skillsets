# Noridoc: init

Path: @/src/cli/commands/init

### Overview

- Initializes Nori configuration directories (`~/.nori/profiles/`) and creates or updates `~/.nori-config.json`
- Detects and captures existing agent configuration as a named profile before Nori overwrites it
- Delegates all agent-specific operations through the default agent from config

### How it fits into the larger codebase

- Called as the first step of the installation flow by `noninteractive()` in @/src/cli/commands/install/install.ts
- The interactive path delegates entirely to `initFlow` in @/src/cli/prompts/flows/init.js, passing callbacks for ancestor checks, config detection, config capture, and initialization
- The non-interactive path runs inline within `initMain()` and uses `@clack/prompts` (`log`, `note`) for all output
- Config persistence uses `loadConfig()` / `saveConfig()` from @/src/cli/config.js, always scoped to the home directory via `getHomeDir()`
- Resolves the default agent using `getDefaultAgents()` from @/src/cli/config.ts and `AgentRegistry.getInstance().get({ name })`
- All agent-specific operations delegate through the resolved default agent's interface methods
- After init, calls `defaultAgent.markInstall()` to mark the directory as having the agent installed

### Core Implementation

- `initMain({ installDir, nonInteractive, skipWarning })` is the single entry point; routes to interactive (`initFlow`) or non-interactive (inline) path based on the `nonInteractive` flag
- **Default agent resolution**: At the start of `initMain`, resolves the default agents by loading existing config (if any), calling `getDefaultAgents({ config })`, and looking up the first agent via `AgentRegistry.getInstance().get({ name })`. All agent-specific operations use this resolved agent.
- **Existing installation skip**: Both the interactive and non-interactive paths check if the default agent is already installed via `defaultAgent.isInstalledAtDir({ path })` to skip existing-config detection. This prevents re-capturing configuration on subsequent inits and uses the agent's own detection logic (e.g., marker files, config content checks).
- **Ancestor warning callback**: The `onCheckAncestors` callback always returns an empty array `[]`. Ancestor detection logic has been removed; no ancestor warnings are displayed
- **Non-interactive config capture**: when no existing Nori config is found but existing agent config exists, auto-captures it as a profile named `"my-profile"` and reports via `log.success()`. Uses `defaultAgent.detectExistingConfig?.({ installDir })` to detect and `defaultAgent.captureExistingConfig?.({ installDir, profileName, config })` to capture.
- **Agent marking**: After saving config, calls `defaultAgent.markInstall({ path, skillsetName })` to write the installation marker. Only the default agent is marked (not all agents via `getAll()`).
- `registerInitCommand({ program })` registers the `init` command with Commander.js, passing through global `--install-dir` and `--non-interactive` options

### Things to Know

- The `onCheckAncestors` callback always returns `[]`; ancestor warning logic has been fully removed
- Config loading uses the zero-arg `loadConfig()` which always reads from `~/.nori-config.json`
- The `skipWarning` parameter exists for downstream callers (like download flows) that run init as a side-effect and do not want the profile persistence warning displayed in the interactive flow
- All CLI output in the non-interactive path uses `@clack/prompts`
- **Agent-agnostic init**: Init is now agent-agnostic and delegates all agent-specific operations through the default agent's interface. The agent name is resolved from `config.defaultAgents` via `getDefaultAgent()`, making init work with any agent that implements the Agent interface. Future agents can participate in init by implementing the optional `detectExistingConfig` and `captureExistingConfig` methods.
- **Config object for capture**: When calling `defaultAgent.captureExistingConfig`, init builds a `Config` object with `installDir` and `activeSkillset` fields. The `activeSkillset` is set to the profile name being captured.
- **No direct Claude Code imports**: Init no longer imports Claude Code-specific modules like `getClaudeMdFile`, `claudeMdLoader`, or `detectExistingConfig`/`captureExistingConfigAsProfile` functions. All agent-specific logic is accessed through the Agent interface.

Created and maintained by Nori.
